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

    var order = Number(record.sort_order);

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
      sortOrder: isFinite(order) ? order : Number.POSITIVE_INFINITY,
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

  /**
   * 差し替え前のHTMLを走査して「名前 → 既存の画像/動画」の対応表を作る。
   *
   * @param {Element} container 静的カードが入っている要素
   * @param {string}  itemSelector カード1枚のセレクタ
   * @param {string[]} nameSelectors 名前が書かれている要素のセレクタ（複数可）
   */
  function collectExistingMedia(container, itemSelector, nameSelectors) {
    var map = {};

    container.querySelectorAll(itemSelector).forEach(function (item) {
      var video = item.querySelector('video');
      var img = item.querySelector('img');
      if (!video && !img) return;

      var entry = {
        video: video ? video.getAttribute('src') : '',
        img: img ? img.getAttribute('src') : '',
      };

      // 表面の名前・裏面の見出しなど、複数の表記で引けるようにしておく
      nameSelectors.forEach(function (selector) {
        item.querySelectorAll(selector).forEach(function (el) {
          var key = nameKey(el.textContent);
          if (key && !map[key]) map[key] = entry;
        });
      });
    });

    return map;
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

  function buildCastCard(cast, index, existingMedia) {
    var rank = cast.cardRank || DEFAULT_RANKS[index % DEFAULT_RANKS.length];
    var symbol = cast.cardSymbol || DEFAULT_SYMBOLS[index % DEFAULT_SYMBOLS.length];

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

    var media = buildCastMedia(cast, findExisting(existingMedia, cast.name));
    if (media) back.appendChild(media);

    var heading = document.createElement('h3');
    heading.textContent = cast.name;
    back.appendChild(heading);

    var desc = document.createElement('p');
    desc.textContent = cast.description;
    back.appendChild(desc);

    if (cast.socialUrl) {
      var link = document.createElement('a');
      link.className = 'insta';
      link.setAttribute('href', cast.socialUrl);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.textContent = cast.socialLabel || guessSocialLabel(cast.socialUrl);
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

  function renderCastGrid(grid, casts) {
    // 差し替える前に、既存カードの画像・動画を退避しておく
    var existingMedia = collectExistingMedia(grid, '.cast-item', ['.title', '.card-back h3']);

    clearChildren(grid);
    casts.forEach(function (cast, index) {
      grid.appendChild(buildCastCard(cast, index, existingMedia));
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
    heading.textContent = food.name;
    body.appendChild(heading);

    var desc = document.createElement('p');
    desc.textContent = food.description;
    body.appendChild(desc);

    article.appendChild(thumb);
    article.appendChild(body);

    return article;
  }

  function renderFoodGrid(grid, foods) {
    // 差し替える前に、既存カードの写真を退避しておく
    var existingMedia = collectExistingMedia(grid, '.menu-card', ['.menu-body h3']);

    clearChildren(grid);
    foods.forEach(function (food) {
      grid.appendChild(buildFoodCard(food, findExisting(existingMedia, food.name)));
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
    var items = records
      .map(normalize)
      .filter(function (item) {
        return item.visible && item.name;
      });

    var casts = sortByOrder(
      items.filter(function (item) {
        return item.type === 'cast';
      })
    );
    var guests = sortByOrder(
      items.filter(function (item) {
        return item.type === 'special_guest';
      })
    );
    var foods = sortByOrder(
      items.filter(function (item) {
        return item.type === 'food';
      })
    );

    /* ---- 通常キャスト（index.html） ---- */
    var castGrid = document.getElementById('castGrid');
    if (castGrid) {
      if (casts.length > 0) {
        renderCastGrid(castGrid, casts);
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

    /* ---- 料理（service.html） ---- */
    var foodGrid = document.getElementById('foodGrid');
    if (foodGrid) {
      if (foods.length > 0) {
        renderFoodGrid(foodGrid, foods);
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
