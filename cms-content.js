/**
 * Bay NYX - microCMS 表示スクリプト
 *
 * 通常キャスト / 期間限定キャスト / 料理 を microCMS から取得して描画します。
 *
 * 設計方針:
 *  - APIキーはこのファイルに書きません。サーバー側（/api/baynyx）が持ちます。
 *  - 取得に失敗した場合・0件の場合は、HTMLに書かれている既存の内容をそのまま残します
 *    （画面にエラーは出さず、Consoleにwarningを出すだけ）。
 *  - HTMLの組み立ては createElement / textContent / setAttribute で行い、
 *    innerHTML への文字列挿入はしません（XSS対策）。
 */

(function () {
  'use strict';

  var API_URL = '/api/baynyx';

  // card_rank / card_symbol が未設定のときに使う既定値
  var DEFAULT_RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
  var DEFAULT_SYMBOLS = ['♠', '♥', '♦', '♣'];

  /* ------------------------------------------------------------------ *
   * 小さなユーティリティ
   * ------------------------------------------------------------------ */

  /**
   * microCMSのセレクトフィールドは配列（例: ["cast"]）で返るため、
   * 文字列・配列のどちらでも受け取れるようにする。
   */
  function toText(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.length ? toText(value[0]) : '';
    return String(value).trim();
  }

  /** http / https のURLだけを許可する。それ以外は空文字を返す。 */
  function safeUrl(value) {
    // 画像・動画フィールドは { url: '...' } のオブジェクトで返ることがある
    var raw = value && typeof value === 'object' && !Array.isArray(value) ? value.url : value;
    raw = toText(raw);
    if (!raw) return '';

    try {
      var parsed = new URL(raw, window.location.href);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
    } catch (e) {
      // 解釈できないURLは使わない
    }
    return '';
  }

  /**
   * SNS表示名(social_label)が未設定のときに、URLからボタンの文字を推測する。
   * 例: tiktok.com のURLなら「TikTok」と表示する。
   */
  function guessSocialLabel(url) {
    var host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch (e) {
      return 'Instagram';
    }
    if (host.indexOf('tiktok.') !== -1) return 'TikTok';
    if (host.indexOf('x.com') !== -1 || host.indexOf('twitter.') !== -1) return 'X';
    if (host.indexOf('youtube.') !== -1 || host.indexOf('youtu.be') !== -1) return 'YouTube';
    if (host.indexOf('line.') !== -1) return 'LINE';
    return 'Instagram';
  }

  /** sort_order 昇順。未設定は最後に回す（同順位は登録順を維持）。 */
  function sortByOrder(items) {
    return items
      .map(function (item, index) {
        return { item: item, index: index };
      })
      .sort(function (a, b) {
        var ao = a.item.sortOrder;
        var bo = b.item.sortOrder;
        if (ao !== bo) return ao - bo;
        return a.index - b.index;
      })
      .map(function (entry) {
        return entry.item;
      });
  }

  /**
   * .fade のフェードイン表示を確定させる。
   *
   * ページ側のIntersectionObserverは「画面内に入ったら .show を付ける」動きだが、
   * 非表示(hidden / display:none)の要素は画面内と判定されないため、
   * あとから表示する要素にはここで .show を付ける。
   * （opacity 0 → 1 のtransitionは残るのでフェードインの見た目は変わらない）
   */
  function revealFade(root) {
    if (root.classList && root.classList.contains('fade')) {
      root.classList.add('show');
    }
    root.querySelectorAll('.fade').forEach(function (el) {
      el.classList.add('show');
    });
  }

  /** 子要素をすべて取り除く */
  function clearChildren(el) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  /* ------------------------------------------------------------------ *
   * microCMSのレコードを、画面で使いやすい形に整える
   * ------------------------------------------------------------------ */

  function normalize(record) {
    // content_type が未設定の既存データは special_guest として扱う（後方互換）
    var type = toText(record.content_type).toLowerCase() || 'special_guest';

    // sort_order は null / undefined / 空文字 / 数値にできない値を「未設定」とみなし、
    // Number.POSITIVE_INFINITY にして必ず最後尾へ回す（0 や NaN と混同しない）
    var rawOrder = record.sort_order;
    var order;
    if (rawOrder === null || rawOrder === undefined || toText(rawOrder) === '') {
      order = Number.POSITIVE_INFINITY;
    } else {
      order = Number(rawOrder);
      if (!isFinite(order)) order = Number.POSITIVE_INFINITY;
    }

    return {
      type: type,
      name: toText(record.name),
      description: toText(record.description),
      photoUrl: safeUrl(record.photo),
      videoUrl: safeUrl(record.video_url),
      socialUrl: safeUrl(record.instagram_url),
      socialLabel: toText(record.social_label),
      cardRank: toText(record.card_rank),
      cardSymbol: toText(record.card_symbol),
      sortOrder: order,
      // is_visible 未設定（undefined / null）は「表示する」
      visible: record.is_visible === false ? false : true,
    };
  }

  /* ------------------------------------------------------------------ *
   * HTMLに差し込まれている既存の画像・動画を引き継ぐ仕組み
   *
   * microCMSに video_url も photo も無いキャストは、HTMLに書かれた
   * 動画・画像（CloudinaryのURL）をそのまま使う。
   * microCMSの「名前」とHTMLのカード名が一致したものを引き継ぐ。
   * ------------------------------------------------------------------ */

  /** 比較用に名前をそろえる（前後の空白を除去し、大文字小文字を無視する） */
  function nameKey(value) {
    return toText(value).toLowerCase();
  }

  /** 「A<br>♠」のような要素から先頭のテキスト（A）だけを取り出す */
  function firstTextOf(el) {
    if (!el) return '';
    var node = el.firstChild;
    return node && node.nodeType === 3 ? toText(node.nodeValue) : toText(el.textContent);
  }

  /**
   * 差し替え前のHTMLを走査して、静的カードの一覧と「名前 → 既存カード」の対応表を作る。
   *
   * 画像・動画だけでなく、カードの数字・記号・見出し・紹介文・SNSリンクも退避する。
   * microCMS側の項目が空のときに、既存デザインをそのまま引き継ぐために使う。
   *
   * @param {Element} container 静的カードが入っている要素
   * @param {string}  itemSelector カード1枚のセレクタ
   * @param {string[]} nameSelectors 名前が書かれている要素のセレクタ（複数可）
   * @returns {{map: Object, list: Array}} map=名前→カード / list=HTMLに並んでいる順のカード
   */
  function collectExistingCards(container, itemSelector, nameSelectors) {
    var map = {};
    var list = [];

    container.querySelectorAll(itemSelector).forEach(function (item) {
      var video = item.querySelector('video');
      var img = item.querySelector('img');
      var link = item.querySelector('a');

      var entry = {
        el: item,
        video: video ? video.getAttribute('src') : '',
        img: img ? img.getAttribute('src') : '',
        rank: firstTextOf(item.querySelector('.rank')),
        symbol: toText(item.querySelector('.symbol') && item.querySelector('.symbol').textContent),
        heading: toText(item.querySelector('h3') && item.querySelector('h3').textContent),
        description: toText(item.querySelector('.card-back p, .menu-body p') &&
          item.querySelector('.card-back p, .menu-body p').textContent),
        socialUrl: link ? link.getAttribute('href') : '',
        socialLabel: link ? toText(link.textContent) : '',
        names: [],
      };

      // 表面の名前・裏面の見出しなど、複数の表記で引けるようにしておく
      nameSelectors.forEach(function (selector) {
        item.querySelectorAll(selector).forEach(function (el) {
          var key = nameKey(el.textContent);
          if (!key) return;
          if (entry.names.indexOf(key) === -1) entry.names.push(key);
          if (!map[key]) map[key] = entry;
        });
      });

      list.push(entry);
    });

    return { map: map, list: list };
  }

  function findExisting(map, name) {
    return map[nameKey(name)] || null;
  }

  /* ------------------------------------------------------------------ *
   * キャストカードの組み立て
   * ------------------------------------------------------------------ */

  function buildVideo(src) {
    var video = document.createElement('video');
    video.setAttribute('src', src);
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.setAttribute('loop', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('preload', 'metadata');
    // 属性だけではミュートにならないブラウザがあるためプロパティも立てる
    video.muted = true;
    return video;
  }

  function buildImage(src, alt) {
    var img = document.createElement('img');
    img.setAttribute('src', src);
    img.setAttribute('alt', alt);
    img.setAttribute('loading', 'lazy');
    return img;
  }

  /**
   * キャストカードのメディアの優先順位:
   *   1. microCMSの video_url（Cloudinaryなどに置いた動画のURL）… 動画は常にこちらが優先
   *   2. microCMSの photo（写真）
   *   3. HTMLに書かれている動画（名前が一致するもの／CloudinaryのURL）
   *   4. HTMLに差し込まれている既存の画像（名前が一致するもの）
   *
   * video_url を空にすると 2 の写真に戻り、写真も無ければ 3 のHTML側に戻ります。
   */
  function buildCastMedia(cast, existing) {
    if (cast.videoUrl) return buildVideo(cast.videoUrl);
    if (cast.photoUrl) return buildImage(cast.photoUrl, cast.name);
    if (existing && existing.video) return buildVideo(existing.video);
    if (existing && existing.img) return buildImage(existing.img, cast.name);
    return null;
  }

  /**
   * @param {Object} cast microCMSのキャスト
   * @param {number} index 既定の数字・記号を選ぶための連番
   * @param {Object|null} existing 名前が一致した既存カード（あれば）
   */
  function buildCastCard(cast, index, existing) {
    // microCMSが空欄なら、既存カードの数字・記号をそのまま引き継ぐ（デザイン維持）
    var rank = cast.cardRank || (existing && existing.rank) ||
      DEFAULT_RANKS[index % DEFAULT_RANKS.length];
    var symbol = cast.cardSymbol || (existing && existing.symbol) ||
      DEFAULT_SYMBOLS[index % DEFAULT_SYMBOLS.length];

    var article = document.createElement('article');
    article.className = 'cast-item';
    article.tabIndex = 0;

    var card = document.createElement('div');
    card.className = 'card';

    /* ---- 表面 ---- */
    var front = document.createElement('div');
    front.className = 'card-face card-front';

    var rankTop = document.createElement('span');
    rankTop.className = 'rank';
    rankTop.appendChild(document.createTextNode(rank));
    rankTop.appendChild(document.createElement('br'));
    rankTop.appendChild(document.createTextNode(symbol));

    var symbolEl = document.createElement('span');
    symbolEl.className = 'symbol';
    symbolEl.textContent = symbol;

    var titleEl = document.createElement('span');
    titleEl.className = 'title';
    titleEl.textContent = cast.name;

    var rankBottom = document.createElement('span');
    rankBottom.className = 'rank bottom';
    rankBottom.appendChild(document.createTextNode(rank));
    rankBottom.appendChild(document.createElement('br'));
    rankBottom.appendChild(document.createTextNode(symbol));

    front.appendChild(rankTop);
    front.appendChild(symbolEl);
    front.appendChild(titleEl);
    front.appendChild(rankBottom);

    /* ---- 裏面 ---- */
    var back = document.createElement('div');
    back.className = 'card-face card-back';

    var media = buildCastMedia(cast, existing);
    if (media) back.appendChild(media);

    // 裏面の見出しは既存表記（例: RAIKA → ライカ）を優先して残す
    var heading = document.createElement('h3');
    heading.textContent = (existing && existing.heading) || cast.name;
    back.appendChild(heading);

    var desc = document.createElement('p');
    desc.textContent = cast.description || (existing && existing.description) || '';
    back.appendChild(desc);

    var socialUrl = cast.socialUrl || (existing && existing.socialUrl) || '';
    if (socialUrl) {
      var link = document.createElement('a');
      link.className = 'insta';
      link.setAttribute('href', socialUrl);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.textContent = cast.socialLabel || (existing && existing.socialLabel) ||
        guessSocialLabel(socialUrl);
      back.appendChild(link);
    }

    card.appendChild(front);
    card.appendChild(back);
    article.appendChild(card);

    // スマートフォンなどタッチ端末では、タップでカードを裏返す
    article.addEventListener('click', function () {
      if (window.matchMedia('(hover: none)').matches) {
        article.classList.toggle('is-flipped');
      }
    });

    return article;
  }

  /* ------------------------------------------------------------------ *
   * 部分更新（マージ）の共通処理
   *
   * 「microCMSにあるものだけ差し替え、無いものは静的HTMLのまま残す」方式。
   * microCMSに1件しか登録していなくても、他のカードが消えないようにする。
   *
   *   ・名前が一致  → microCMSの内容で置き換える（空欄は既存内容を引き継ぐ）
   *   ・CMSに無い   → 静的HTMLのまま残す
   *   ・CMSにだけ有 → 新規カードとして末尾に追加（sort_order順）
   *   ・is_visible=false → 名前が一致する静的カードも非表示にする
   * ------------------------------------------------------------------ */

  /**
   * @param {Element} grid 対象のグリッド
   * @param {Array} items microCMSの項目（sort_order順・非表示分も含む）
   * @param {string} itemSelector カード1枚のセレクタ
   * @param {string[]} nameSelectors 名前が書かれている要素のセレクタ
   * @param {Function} build (item, index, existing) => Element
   */
  function mergeGrid(grid, items, itemSelector, nameSelectors, build) {
    var existing = collectExistingCards(grid, itemSelector, nameSelectors);
    var used = {};
    var appended = 0;

    items.forEach(function (item, index) {
      var match = findExisting(existing.map, item.name);

      if (match) {
        // 同じ静的カードに2件以上が一致した場合、2件目以降は新規扱いにする
        if (used[match.names[0]]) {
          match = null;
        } else {
          match.names.forEach(function (key) {
            used[key] = true;
          });
        }
      }

      if (match) {
        if (!item.visible) {
          // 非表示指定 → 一致する静的カードを取り除く
          if (match.el.parentNode) match.el.parentNode.removeChild(match.el);
          return;
        }
        // 位置はそのままに、中身だけ差し替える（並び順とデザインを維持）
        var replacement = build(item, index, match);
        if (match.el.parentNode) {
          match.el.parentNode.replaceChild(replacement, match.el);
        }
        return;
      }

      // microCMSにだけ存在する新規カード（非表示指定なら何もしない）
      if (!item.visible) return;
      grid.appendChild(build(item, existing.list.length + appended, null));
      appended += 1;
    });
  }

  function mergeCastGrid(grid, casts) {
    mergeGrid(grid, casts, '.cast-item', ['.title', '.card-back h3'], buildCastCard);
  }

  /** Special Guest は従来どおり「microCMSの内容で全置き換え」 */
  function renderCastGrid(grid, casts) {
    var existing = collectExistingCards(grid, '.cast-item', ['.title', '.card-back h3']);

    clearChildren(grid);
    casts.forEach(function (cast, index) {
      grid.appendChild(buildCastCard(cast, index, findExisting(existing.map, cast.name)));
    });
  }

  /* ------------------------------------------------------------------ *
   * 料理カードの組み立て
   * ------------------------------------------------------------------ */

  function buildFoodCard(food, existing) {
    var article = document.createElement('article');
    article.className = 'menu-card';

    var thumb = document.createElement('div');
    thumb.className = 'menu-thumb';

    // microCMSに写真が無ければ、HTMLに差し込まれている既存の写真を引き継ぐ
    var src = food.photoUrl || (existing && existing.img) || '';
    if (src) {
      thumb.appendChild(buildImage(src, food.name));
    }

    var body = document.createElement('div');
    body.className = 'menu-body';

    var heading = document.createElement('h3');
    heading.textContent = (existing && existing.heading) || food.name;
    body.appendChild(heading);

    var desc = document.createElement('p');
    desc.textContent = food.description || (existing && existing.description) || '';
    body.appendChild(desc);

    article.appendChild(thumb);
    article.appendChild(body);

    return article;
  }

  function mergeFoodGrid(grid, foods) {
    mergeGrid(grid, foods, '.menu-card', ['.menu-body h3'], function (food, index, existing) {
      return buildFoodCard(food, existing);
    });
  }

  /* ------------------------------------------------------------------ *
   * 取得と振り分け
   * ------------------------------------------------------------------ */

  function fetchContents() {
    return fetch(API_URL, { headers: { Accept: 'application/json' } })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('API responded with ' + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.contents)) {
          throw new Error('Unexpected response format');
        }
        return data.contents;
      });
  }

  function apply(records) {
    // is_visible=false もここでは捨てない。
    // 「名前が一致する静的カードを非表示にする」ためにマージ処理まで渡す。
    var items = records
      .map(normalize)
      .filter(function (item) {
        return item.name;
      });

    var casts = sortByOrder(
      items.filter(function (item) {
        return item.type === 'cast';
      })
    );
    // Special Guest は全置き換え方式のため、非表示分はここで除外する
    var guests = sortByOrder(
      items.filter(function (item) {
        return item.type === 'special_guest' && item.visible;
      })
    );
    var foods = sortByOrder(
      items.filter(function (item) {
        return item.type === 'food';
      })
    );

    /* ---- 通常キャスト（index.html）: 部分更新 ---- */
    var castGrid = document.getElementById('castGrid');
    if (castGrid) {
      if (casts.length > 0) {
        mergeCastGrid(castGrid, casts);
      } else {
        console.warn('[cms-content] 通常キャストのデータが0件のため、既存の内容を表示します。');
      }
    }

    /* ---- 期間限定キャスト（index.html） ---- */
    var guestGrid = document.getElementById('specialGuestGrid');
    var guestSection = document.getElementById('specialGuestSection');
    if (guestGrid) {
      if (guests.length > 0) {
        renderCastGrid(guestGrid, guests);
        // データが取得できたときだけ「Special Guest Card を見る」を表示する
        if (guestSection) {
          guestSection.hidden = false;
          revealFade(guestSection);
        }
      } else {
        console.warn('[cms-content] 期間限定キャストが0件のため、Special Guestは非表示にします。');
      }
    }

    /* ---- 料理（service.html）: 部分更新 ---- */
    var foodGrid = document.getElementById('foodGrid');
    if (foodGrid) {
      if (foods.length > 0) {
        mergeFoodGrid(foodGrid, foods);
      } else {
        console.warn('[cms-content] 料理のデータが0件のため、既存の内容を表示します。');
      }
    }
  }

  function init() {
    fetchContents()
      .then(apply)
      .catch(function (error) {
        // 失敗しても画面にはエラーを出さず、HTMLに書かれている内容をそのまま使う
        console.warn(
          '[cms-content] microCMSの内容を取得できませんでした。既存の内容を表示します:',
          error && error.message ? error.message : error
        );
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
