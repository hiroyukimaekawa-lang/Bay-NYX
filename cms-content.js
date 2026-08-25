/**
 * Bay NYX - microCMS 動的コンテンツ描画スクリプト (ハイブリッド方式)
 *
 * 料理 (food-menu) および スタッフ (staff Golden Cards) を microCMS から取得し描画します。
 *
 * 設計方針:
 *  - APIキーはクライアント側に保持せず、Netlify Function (/food-menu, /staff) 経由で取得。
 *  - 取得失敗・環境変数未設定時は、静的HTML要素 (フォールバック) をそのまま残します。
 *  - ハイブリッド移行: microCMSに存在するデータ (key一致) のみ置換・表示更新、新規追加項目は sortOrder 順に挿入。
 *  - textContent による XSS 対策および safeUrl による URL スキーム (http/https) 検証を実施。
 */

(function () {
  'use strict';

  var FOOD_API_URL = '/.netlify/functions/food-menu';
  var STAFF_API_URL = '/.netlify/functions/staff';

  var DEFAULT_RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
  var DEFAULT_SYMBOLS = ['♠', '♥', '♦', '♣'];

  /* ------------------------------------------------------------------ *
   * ユーティリティ
   * ------------------------------------------------------------------ */

  function toText(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.length ? toText(value[0]) : '';
    return String(value).trim();
  }

  /** http: または https: の安全なURLのみ許可 */
  function safeUrl(value) {
    var raw = value && typeof value === 'object' && !Array.isArray(value) ? value.url : value;
    raw = toText(raw);
    if (!raw) return '';

    try {
      var parsed = new URL(raw, window.location.href);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
    } catch (e) {
      // 無効なURL
    }
    return '';
  }

  /** カードスートの記号変換 (heart -> ♥, diamond -> ♦, spade -> ♠, club -> ♣) */
  function normalizeSuit(suit) {
    var s = toText(suit).toLowerCase();
    if (s === 'heart' || s === 'hearts') return '♥';
    if (s === 'diamond' || s === 'diamonds') return '♦';
    if (s === 'spade' || s === 'spades') return '♠';
    if (s === 'club' || s === 'clubs') return '♣';
    if (suit) return suit; // 既に記号が入っている場合
    return '♠';
  }

  /** SNS種別・URLからボタン表記を確定 */
  function getSocialLabel(type, url) {
    var t = toText(type).toLowerCase();
    if (t === 'instagram') return 'Instagram';
    if (t === 'tiktok') return 'TikTok';
    if (t === 'x' || t === 'twitter') return 'X';
    if (t === 'none') return '';

    if (!url) return 'Instagram';
    var host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch (e) {
      return 'Instagram';
    }
    if (host.indexOf('tiktok.') !== -1) return 'TikTok';
    if (host.indexOf('x.com') !== -1 || host.indexOf('twitter.') !== -1) return 'X';
    return 'Instagram';
  }

  /** 第一ソート: sortOrder (昇順), 第二ソート: key (辞書順) */
  function sortItems(items) {
    return items.slice().sort(function (a, b) {
      var ao = typeof a.sortOrder === 'number' && isFinite(a.sortOrder) ? a.sortOrder : Infinity;
      var bo = typeof b.sortOrder === 'number' && isFinite(b.sortOrder) ? b.sortOrder : Infinity;
      if (ao !== bo) return ao - bo;
      var ak = a.key || '';
      var bk = b.key || '';
      return ak.localeCompare(bk);
    });
  }

  function fetchJSON(url) {
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.contents)) {
          throw new Error('Invalid response format');
        }
        return data.contents;
      });
  }

  /** コンテナ内の要素を sortOrder に従って適切な位置へ並び替え・挿入 */
  function insertBySortOrder(container, newElement, newSortOrder, newKey) {
    var children = Array.prototype.slice.call(container.children);
    var targetNode = null;

    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var childOrder = Number(child.getAttribute('data-sort-order')) || Infinity;
      var childKey = child.getAttribute('data-cms-key') || '';

      if (
        newSortOrder < childOrder ||
        (newSortOrder === childOrder && newKey.localeCompare(childKey) < 0)
      ) {
        targetNode = child;
        break;
      }
    }

    if (targetNode) {
      container.insertBefore(newElement, targetNode);
    } else {
      container.appendChild(newElement);
    }
  }

  /* ------------------------------------------------------------------ *
   * 料理メニュー (food-menu) ハイブリッド描画
   * ------------------------------------------------------------------ */

  function normalizeFood(record) {
    var rawOrder = record.sortOrder !== undefined ? record.sortOrder : record.sort_order;
    var order = Number(rawOrder);
    if (!isFinite(order)) order = Infinity;

    return {
      key: toText(record.key),
      name: toText(record.name),
      description: toText(record.description),
      photoUrl: safeUrl(record.image || record.photo),
      sortOrder: order,
      isVisible: record.isVisible !== undefined ? Boolean(record.isVisible) : record.is_visible !== false,
    };
  }

  function createFoodCard(food) {
    var article = document.createElement('article');
    article.className = 'menu-card';
    if (food.key) article.setAttribute('data-cms-key', food.key);
    article.setAttribute('data-sort-order', isFinite(food.sortOrder) ? food.sortOrder : 999);

    var thumb = document.createElement('div');
    thumb.className = 'menu-thumb';
    if (food.photoUrl) {
      var img = document.createElement('img');
      img.setAttribute('src', food.photoUrl);
      img.setAttribute('alt', food.name);
      img.setAttribute('loading', 'lazy');
      thumb.appendChild(img);
    }
    article.appendChild(thumb);

    var body = document.createElement('div');
    body.className = 'menu-body';

    var h3 = document.createElement('h3');
    h3.textContent = food.name;
    body.appendChild(h3);

    var p = document.createElement('p');
    p.textContent = food.description;
    body.appendChild(p);

    article.appendChild(body);
    return article;
  }

  function applyFoodMenu(records) {
    var grid = document.getElementById('foodGrid');
    if (!grid) return;

    var foods = sortItems(records.map(normalizeFood).filter(function (f) { return f.key || f.name; }));
    if (foods.length === 0) return;

    foods.forEach(function (food) {
      var existing = food.key ? grid.querySelector('[data-cms-key="' + food.key + '"]') : null;

      // 非表示の場合
      if (!food.isVisible) {
        if (existing) existing.style.display = 'none';
        return;
      }

      if (existing) {
        // 既存カードの置換・更新
        existing.style.display = '';
        existing.setAttribute('data-sort-order', food.sortOrder);
        var img = existing.querySelector('.menu-thumb img');
        if (food.photoUrl) {
          if (img) {
            img.setAttribute('src', food.photoUrl);
            img.setAttribute('alt', food.name);
          } else {
            var newImg = document.createElement('img');
            newImg.setAttribute('src', food.photoUrl);
            newImg.setAttribute('alt', food.name);
            newImg.setAttribute('loading', 'lazy');
            var thumb = existing.querySelector('.menu-thumb');
            if (thumb) thumb.appendChild(newImg);
          }
        }
        var h3 = existing.querySelector('.menu-body h3');
        if (h3 && food.name) h3.textContent = food.name;
        var p = existing.querySelector('.menu-body p');
        if (p && food.description !== undefined) p.textContent = food.description;
      } else {
        // 新規カードの動的挿入
        var newCard = createFoodCard(food);
        insertBySortOrder(grid, newCard, food.sortOrder, food.key);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * スタッフ Golden Cards (staff) ハイブリッド描画
   * ------------------------------------------------------------------ */

  function normalizeStaff(record, index) {
    var rawOrder = record.sortOrder !== undefined ? record.sortOrder : record.sort_order;
    var order = Number(rawOrder);
    if (!isFinite(order)) order = Infinity;

    return {
      key: toText(record.key),
      name: toText(record.name),
      description: toText(record.description),
      photoUrl: safeUrl(record.image || record.photo),
      cardRank: toText(record.cardRank || record.card_rank) || DEFAULT_RANKS[index % DEFAULT_RANKS.length],
      cardSuit: normalizeSuit(record.cardSuit || record.card_symbol || DEFAULT_SYMBOLS[index % DEFAULT_SYMBOLS.length]),
      socialType: toText(record.socialType || record.social_label),
      socialUrl: safeUrl(record.socialUrl || record.instagram_url),
      sortOrder: order,
      isVisible: record.isVisible !== undefined ? Boolean(record.isVisible) : record.is_visible !== false,
    };
  }

  function createStaffCard(staff) {
    var article = document.createElement('article');
    article.className = 'cast-item';
    article.tabIndex = 0;
    if (staff.key) article.setAttribute('data-cms-key', staff.key);
    article.setAttribute('data-sort-order', isFinite(staff.sortOrder) ? staff.sortOrder : 999);

    var card = document.createElement('div');
    card.className = 'card';

    /* ---- 表面 ---- */
    var front = document.createElement('div');
    front.className = 'card-face card-front';

    var rankTop = document.createElement('span');
    rankTop.className = 'rank';
    rankTop.appendChild(document.createTextNode(staff.cardRank));
    rankTop.appendChild(document.createElement('br'));
    rankTop.appendChild(document.createTextNode(staff.cardSuit));

    var symbolEl = document.createElement('span');
    symbolEl.className = 'symbol';
    symbolEl.textContent = staff.cardSuit;

    var titleEl = document.createElement('span');
    titleEl.className = 'title';
    titleEl.textContent = staff.name;

    var rankBottom = document.createElement('span');
    rankBottom.className = 'rank bottom';
    rankBottom.appendChild(document.createTextNode(staff.cardRank));
    rankBottom.appendChild(document.createElement('br'));
    rankBottom.appendChild(document.createTextNode(staff.cardSuit));

    front.appendChild(rankTop);
    front.appendChild(symbolEl);
    front.appendChild(titleEl);
    front.appendChild(rankBottom);

    /* ---- 裏面 ---- */
    var back = document.createElement('div');
    back.className = 'card-face card-back';

    if (staff.photoUrl) {
      var img = document.createElement('img');
      img.setAttribute('src', staff.photoUrl);
      img.setAttribute('alt', staff.name);
      img.setAttribute('loading', 'lazy');
      back.appendChild(img);
    }

    var heading = document.createElement('h3');
    heading.textContent = staff.name;
    back.appendChild(heading);

    if (staff.description) {
      var desc = document.createElement('p');
      desc.textContent = staff.description;
      back.appendChild(desc);
    }

    if (staff.socialUrl) {
      var link = document.createElement('a');
      link.className = 'insta';
      link.setAttribute('href', staff.socialUrl);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.textContent = getSocialLabel(staff.socialType, staff.socialUrl);
      back.appendChild(link);
    }

    card.appendChild(front);
    card.appendChild(back);
    article.appendChild(card);

    // タッチ端末用裏えし対応
    article.addEventListener('click', function () {
      if (window.matchMedia('(hover: none)').matches) {
        article.classList.toggle('is-flipped');
      }
    });

    return article;
  }

  function applyStaffMenu(records) {
    var grid = document.getElementById('castGrid');
    if (!grid) return;

    var staffList = sortItems(records.map(normalizeStaff).filter(function (s) { return s.key || s.name; }));
    if (staffList.length === 0) return;

    staffList.forEach(function (staff) {
      var existing = staff.key ? grid.querySelector('[data-cms-key="' + staff.key + '"]') : null;

      // 非表示の場合
      if (!staff.isVisible) {
        if (existing) existing.style.display = 'none';
        return;
      }

      if (existing) {
        // 既存カードの更新
        existing.style.display = '';
        existing.setAttribute('data-sort-order', staff.sortOrder);

        // 表面ランク・スート・タイトルの更新
        var rankTop = existing.querySelector('.card-front .rank:not(.bottom)');
        if (rankTop) {
          while (rankTop.firstChild) rankTop.removeChild(rankTop.firstChild);
          rankTop.appendChild(document.createTextNode(staff.cardRank));
          rankTop.appendChild(document.createElement('br'));
          rankTop.appendChild(document.createTextNode(staff.cardSuit));
        }

        var symbolEl = existing.querySelector('.card-front .symbol');
        if (symbolEl) symbolEl.textContent = staff.cardSuit;

        var titleEl = existing.querySelector('.card-front .title');
        if (titleEl && staff.name) titleEl.textContent = staff.name;

        var rankBottom = existing.querySelector('.card-front .rank.bottom');
        if (rankBottom) {
          while (rankBottom.firstChild) rankBottom.removeChild(rankBottom.firstChild);
          rankBottom.appendChild(document.createTextNode(staff.cardRank));
          rankBottom.appendChild(document.createElement('br'));
          rankBottom.appendChild(document.createTextNode(staff.cardSuit));
        }

        // 裏面写真・見出し・説明・SNSの更新
        var back = existing.querySelector('.card-back');
        if (back) {
          if (staff.photoUrl) {
            var existingImg = back.querySelector('img');
            var existingVideo = back.querySelector('video');
            if (existingImg) {
              existingImg.setAttribute('src', staff.photoUrl);
              existingImg.setAttribute('alt', staff.name);
            } else if (!existingVideo) {
              var newImg = document.createElement('img');
              newImg.setAttribute('src', staff.photoUrl);
              newImg.setAttribute('alt', staff.name);
              newImg.setAttribute('loading', 'lazy');
              back.insertBefore(newImg, back.firstChild);
            }
          }

          var h3 = back.querySelector('h3');
          if (h3 && staff.name) h3.textContent = staff.name;

          var p = back.querySelector('p');
          if (p && staff.description) p.textContent = staff.description;

          if (staff.socialUrl) {
            var a = back.querySelector('a');
            if (a) {
              a.setAttribute('href', staff.socialUrl);
              a.textContent = getSocialLabel(staff.socialType, staff.socialUrl);
            } else {
              var newA = document.createElement('a');
              newA.className = 'insta';
              newA.setAttribute('href', staff.socialUrl);
              newA.setAttribute('target', '_blank');
              newA.setAttribute('rel', 'noopener noreferrer');
              newA.textContent = getSocialLabel(staff.socialType, staff.socialUrl);
              back.appendChild(newA);
            }
          }
        }
      } else {
        // 新規カードの動的挿入
        var newCard = createStaffCard(staff);
        insertBySortOrder(grid, newCard, staff.sortOrder, staff.key);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 初期化
   * ------------------------------------------------------------------ */

  function init() {
    // 料理 API の独立取得と適用
    if (document.getElementById('foodGrid')) {
      fetchJSON(FOOD_API_URL)
        .then(applyFoodMenu)
        .catch(function (err) {
          console.warn('[cms-content] 料理データの取得に失敗しました。フォールバックHTMLを表示します:', err.message || err);
        });
    }

    // スタッフ API の独立取得と適用
    if (document.getElementById('castGrid')) {
      fetchJSON(STAFF_API_URL)
        .then(applyStaffMenu)
        .catch(function (err) {
          console.warn('[cms-content] スタッフデータの取得に失敗しました。フォールバックHTMLを表示します:', err.message || err);
        });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
