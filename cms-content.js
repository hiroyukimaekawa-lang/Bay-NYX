/**
 * Bay NYX - microCMS dynamic content renderer (hybrid mode)
 *
 * food-menu / staff を Cloudflare Pages Functions または Netlify Functions 経由で取得し、
 * 既存HTMLをフォールバックとして key一致のカードだけ更新します。
 * CMSにだけ存在する項目は sortOrder 順に追加します。
 */
(function () {
  'use strict';

  // Cloudflare Pages を優先し、利用できない場合は Netlify Functions へフォールバックする。
  var FOOD_API_URLS = ['/api/food-menu', '/.netlify/functions/food-menu'];
  var STAFF_API_URLS = ['/api/staff', '/.netlify/functions/staff'];
  var FALLBACK_ORDER = 999999;
  var DEFAULT_RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
  var DEFAULT_SYMBOLS = ['♠', '♥', '♦', '♣'];

  function toText(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.length ? toText(value[0]) : '';
    return String(value).trim();
  }

  function toOrder(value) {
    if (value === null || value === undefined || value === '') return Infinity;
    var n = Number(value);
    return isFinite(n) ? n : Infinity;
  }

  /** http / https のURLだけを許可する。 */
  function safeUrl(value) {
    var raw = value && typeof value === 'object' && !Array.isArray(value) ? value.url : value;
    raw = toText(raw);
    if (!raw) return '';
    try {
      var parsed = new URL(raw, window.location.href);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch (e) {
      return '';
    }
  }

  function normalizeSuit(value) {
    var suit = toText(value).toLowerCase();
    if (suit === 'heart' || suit === 'hearts' || suit === '♥') return '♥';
    if (suit === 'diamond' || suit === 'diamonds' || suit === '♦') return '♦';
    if (suit === 'spade' || suit === 'spades' || suit === '♠') return '♠';
    if (suit === 'club' || suit === 'clubs' || suit === '♣') return '♣';
    return toText(value) || '♠';
  }

  function getSocialLabel(type, url) {
    var t = toText(type).toLowerCase();
    if (t === 'instagram') return 'Instagram';
    if (t === 'tiktok') return 'TikTok';
    if (t === 'x' || t === 'twitter') return 'X';
    if (t === 'none') return '';

    if (!url) return '';
    try {
      var host = new URL(url).hostname.toLowerCase();
      if (host.indexOf('tiktok.') !== -1) return 'TikTok';
      if (host.indexOf('x.com') !== -1 || host.indexOf('twitter.') !== -1) return 'X';
      if (host.indexOf('instagram.') !== -1) return 'Instagram';
    } catch (e) {
      return '';
    }
    return 'SNS';
  }

  function compareItems(a, b) {
    var ao = isFinite(a.sortOrder) ? a.sortOrder : Infinity;
    var bo = isFinite(b.sortOrder) ? b.sortOrder : Infinity;
    if (ao !== bo) return ao - bo;
    return (a.key || '').localeCompare(b.key || '');
  }

  function sortItems(items) {
    return items.slice().sort(compareItems);
  }

  /**
   * 同じサイトを Cloudflare Pages / Netlify のどちらへ置いても動くよう、
   * API候補を先頭から試す。全候補が失敗した場合だけ静的HTMLへフォールバックする。
   */
  function fetchJSON(urls) {
    var candidates = Array.isArray(urls) ? urls : [urls];

    function attempt(index, lastError) {
      if (index >= candidates.length) {
        return Promise.reject(lastError || new Error('No API endpoint available'));
      }

      var url = candidates[index];
      return fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (response) {
          if (!response.ok) throw new Error(url + ' HTTP ' + response.status);
          return response.json();
        })
        .then(function (data) {
          if (!data || !Array.isArray(data.contents)) throw new Error(url + ' invalid response');
          return data.contents;
        })
        .catch(function (error) {
          return attempt(index + 1, error);
        });
    }

    return attempt(0, null);
  }

  function findByKey(container, key) {
    if (!key) return null;
    var nodes = container.querySelectorAll('[data-cms-key]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-cms-key') === key) return nodes[i];
    }
    return null;
  }

  /**
   * 既存要素も含めて sortOrder / key 順に正しい位置へ移動する。
   * element 自身は比較対象から外すため、既存カードの並び替えにも使える。
   */
  function placeBySortOrder(container, element, sortOrder, key) {
    var order = isFinite(sortOrder) ? sortOrder : FALLBACK_ORDER;
    element.setAttribute('data-sort-order', String(order));
    if (key) element.setAttribute('data-cms-key', key);

    var children = Array.prototype.slice.call(container.children);
    var target = null;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child === element) continue;

      var childOrder = toOrder(child.getAttribute('data-sort-order'));
      var childKey = child.getAttribute('data-cms-key') || '';
      if (order < childOrder || (order === childOrder && (key || '').localeCompare(childKey) < 0)) {
        target = child;
        break;
      }
    }

    if (target) container.insertBefore(element, target);
    else container.appendChild(element);
  }

  function normalizeFood(record) {
    return {
      key: toText(record.key),
      name: toText(record.name),
      description: toText(record.description),
      photoUrl: safeUrl(record.image || record.photo),
      sortOrder: toOrder(record.sortOrder !== undefined ? record.sortOrder : record.sort_order),
      isVisible: record.isVisible !== undefined ? record.isVisible === true : record.is_visible !== false,
    };
  }

  function createFoodCard(food) {
    var article = document.createElement('article');
    article.className = 'menu-card';

    var thumb = document.createElement('div');
    thumb.className = 'menu-thumb';
    if (food.photoUrl) {
      var img = document.createElement('img');
      img.src = food.photoUrl;
      img.alt = food.name;
      img.loading = 'lazy';
      thumb.appendChild(img);
    }

    var body = document.createElement('div');
    body.className = 'menu-body';
    var title = document.createElement('h3');
    title.textContent = food.name;
    var description = document.createElement('p');
    description.textContent = food.description;
    body.appendChild(title);
    body.appendChild(description);

    article.appendChild(thumb);
    article.appendChild(body);
    return article;
  }

  function updateFoodCard(card, food) {
    card.style.display = '';

    var thumb = card.querySelector('.menu-thumb');
    var img = thumb ? thumb.querySelector('img') : null;
    if (food.photoUrl && thumb) {
      if (!img) {
        img = document.createElement('img');
        img.loading = 'lazy';
        thumb.appendChild(img);
      }
      img.src = food.photoUrl;
      img.alt = food.name;
    }

    var title = card.querySelector('.menu-body h3');
    if (title && food.name) title.textContent = food.name;
    var description = card.querySelector('.menu-body p');
    if (description) description.textContent = food.description;
  }

  function applyFoodMenu(records) {
    var grid = document.getElementById('foodGrid');
    if (!grid) return;

    var foods = sortItems(records.map(normalizeFood).filter(function (food) {
      return food.key || food.name;
    }));

    foods.forEach(function (food) {
      var existing = findByKey(grid, food.key);
      if (!food.isVisible) {
        if (existing) existing.style.display = 'none';
        return;
      }

      var card = existing || createFoodCard(food);
      if (existing) updateFoodCard(card, food);
      placeBySortOrder(grid, card, food.sortOrder, food.key);
    });
  }

  function normalizeStaff(record, index) {
    return {
      key: toText(record.key),
      name: toText(record.name),
      description: toText(record.description),
      photoUrl: safeUrl(record.image || record.photo),
      cardRank: toText(record.cardRank || record.card_rank) || DEFAULT_RANKS[index % DEFAULT_RANKS.length],
      cardSuit: normalizeSuit(record.cardSuit || record.card_symbol || DEFAULT_SYMBOLS[index % DEFAULT_SYMBOLS.length]),
      socialType: toText(record.socialType || record.social_label).toLowerCase(),
      socialUrl: safeUrl(record.socialUrl || record.instagram_url),
      sortOrder: toOrder(record.sortOrder !== undefined ? record.sortOrder : record.sort_order),
      isVisible: record.isVisible !== undefined ? record.isVisible === true : record.is_visible !== false,
    };
  }

  function writeRank(element, rank, suit) {
    if (!element) return;
    while (element.firstChild) element.removeChild(element.firstChild);
    element.appendChild(document.createTextNode(rank));
    element.appendChild(document.createElement('br'));
    element.appendChild(document.createTextNode(suit));
  }

  function attachMobileFlip(article) {
    article.addEventListener('click', function () {
      if (window.matchMedia('(hover: none)').matches) article.classList.toggle('is-flipped');
    });
  }

  function createStaffCard(staff) {
    var article = document.createElement('article');
    article.className = 'cast-item';
    article.tabIndex = 0;

    var card = document.createElement('div');
    card.className = 'card';

    var front = document.createElement('div');
    front.className = 'card-face card-front';
    var rankTop = document.createElement('span');
    rankTop.className = 'rank';
    writeRank(rankTop, staff.cardRank, staff.cardSuit);
    var symbol = document.createElement('span');
    symbol.className = 'symbol';
    symbol.textContent = staff.cardSuit;
    var title = document.createElement('span');
    title.className = 'title';
    title.textContent = staff.name;
    var rankBottom = document.createElement('span');
    rankBottom.className = 'rank bottom';
    writeRank(rankBottom, staff.cardRank, staff.cardSuit);
    front.appendChild(rankTop);
    front.appendChild(symbol);
    front.appendChild(title);
    front.appendChild(rankBottom);

    var back = document.createElement('div');
    back.className = 'card-face card-back';
    if (staff.photoUrl) {
      var img = document.createElement('img');
      img.src = staff.photoUrl;
      img.alt = staff.name;
      img.loading = 'lazy';
      back.appendChild(img);
    }
    var heading = document.createElement('h3');
    heading.textContent = staff.name;
    back.appendChild(heading);
    if (staff.description) {
      var description = document.createElement('p');
      description.textContent = staff.description;
      back.appendChild(description);
    }
    if (staff.socialUrl && staff.socialType !== 'none') {
      var link = document.createElement('a');
      link.className = 'insta';
      link.href = staff.socialUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = getSocialLabel(staff.socialType, staff.socialUrl);
      back.appendChild(link);
    }

    card.appendChild(front);
    card.appendChild(back);
    article.appendChild(card);
    attachMobileFlip(article);
    return article;
  }

  function updateStaffCard(card, staff) {
    card.style.display = '';

    writeRank(card.querySelector('.card-front .rank:not(.bottom)'), staff.cardRank, staff.cardSuit);
    writeRank(card.querySelector('.card-front .rank.bottom'), staff.cardRank, staff.cardSuit);

    var symbol = card.querySelector('.card-front .symbol');
    if (symbol) symbol.textContent = staff.cardSuit;
    var title = card.querySelector('.card-front .title');
    if (title && staff.name) title.textContent = staff.name;

    var back = card.querySelector('.card-back');
    if (!back) return;

    // CMSに画像が設定されている場合は既存の画像/動画より優先する。
    if (staff.photoUrl) {
      var media = back.querySelector('img, video');
      var image;
      if (media && media.tagName === 'IMG') {
        image = media;
      } else {
        image = document.createElement('img');
        image.loading = 'lazy';
        if (media) media.parentNode.replaceChild(image, media);
        else back.insertBefore(image, back.firstChild);
      }
      image.src = staff.photoUrl;
      image.alt = staff.name;
    }

    var heading = back.querySelector('h3');
    if (heading && staff.name) heading.textContent = staff.name;

    // 任意項目が空の場合は既存HTMLのフォールバック文言を残す。
    if (staff.description) {
      var description = back.querySelector('p');
      if (!description) {
        description = document.createElement('p');
        var linkForInsert = back.querySelector('a');
        if (linkForInsert) back.insertBefore(description, linkForInsert);
        else back.appendChild(description);
      }
      description.textContent = staff.description;
    }

    var existingLink = back.querySelector('a');
    if (staff.socialType === 'none') {
      if (existingLink) existingLink.remove();
    } else if (staff.socialUrl) {
      if (!existingLink) {
        existingLink = document.createElement('a');
        existingLink.className = 'insta';
        existingLink.target = '_blank';
        existingLink.rel = 'noopener noreferrer';
        back.appendChild(existingLink);
      }
      existingLink.href = staff.socialUrl;
      existingLink.textContent = getSocialLabel(staff.socialType, staff.socialUrl);
    }
  }

  function applyStaffMenu(records) {
    var grid = document.getElementById('castGrid');
    if (!grid) return;

    var staffList = sortItems(records.map(normalizeStaff).filter(function (staff) {
      return staff.key || staff.name;
    }));

    staffList.forEach(function (staff) {
      var existing = findByKey(grid, staff.key);
      if (!staff.isVisible) {
        if (existing) existing.style.display = 'none';
        return;
      }

      var card = existing || createStaffCard(staff);
      if (existing) updateStaffCard(card, staff);
      placeBySortOrder(grid, card, staff.sortOrder, staff.key);
    });
  }

  function init() {
    if (document.getElementById('foodGrid')) {
      fetchJSON(FOOD_API_URLS)
        .then(applyFoodMenu)
        .catch(function (error) {
          console.warn('[cms-content] 料理データの取得に失敗しました。フォールバックHTMLを表示します:', error.message || error);
        });
    }

    if (document.getElementById('castGrid')) {
      fetchJSON(STAFF_API_URLS)
        .then(applyStaffMenu)
        .catch(function (error) {
          console.warn('[cms-content] スタッフデータの取得に失敗しました。フォールバックHTMLを表示します:', error.message || error);
        });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
