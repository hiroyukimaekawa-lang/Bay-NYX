const navbar = document.getElementById('navbar');
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');
const backToTopButton = document.getElementById('backToTop');

window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 40);
    backToTopButton.classList.toggle('visible', window.scrollY > 500);
    highlightNavigation();
});

navToggle.addEventListener('click', () => {
    navToggle.classList.toggle('active');
    navMenu.classList.toggle('active');
});

document.querySelectorAll('.nav-menu a').forEach(link => {
    link.addEventListener('click', () => {
        navToggle.classList.remove('active');
        navMenu.classList.remove('active');
    });
});

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const target = document.querySelector(this.getAttribute('href'));
        if (!target) return;

        e.preventDefault();
        const top = target.offsetTop - navbar.offsetHeight;
        window.scrollTo({ top, behavior: 'smooth' });
    });
});

const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        }
    });
}, {
    threshold: 0.15,
    rootMargin: '0px 0px -20px 0px'
});

document.querySelectorAll('.fade-in').forEach((el) => observer.observe(el));

backToTopButton.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

function highlightNavigation() {
    const sections = document.querySelectorAll('section[id], header[id]');
    const links = document.querySelectorAll('.nav-menu a');
    const y = window.scrollY;

    sections.forEach((section) => {
        const top = section.offsetTop - 120;
        const bottom = top + section.offsetHeight;
        const id = section.getAttribute('id');

        if (y >= top && y < bottom) {
            links.forEach((link) => {
                const active = link.getAttribute('href') === `#${id}`;
                link.classList.toggle('active', active);
            });
        }
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navMenu.classList.contains('active')) {
        navToggle.classList.remove('active');
        navMenu.classList.remove('active');
    }
});

window.addEventListener('load', highlightNavigation);

// --- microCMSからの期間限定キャストデータ取得 ---
const MICROCMS_API_KEY = 'LJJID0Ahj0JhYw2r1qxu7wHKYxQqXYhCsqg9'; // ※実際のAPIキーに変更してください
const MICROCMS_SERVICE_DOMAIN = 'l9pawk28o1';
const MICROCMS_ENDPOINT = 'baynyx';

async function fetchSpecialGuests() {
    try {
        const response = await fetch(`https://${MICROCMS_SERVICE_DOMAIN}.microcms.io/api/v1/${MICROCMS_ENDPOINT}`, {
            headers: {
                'X-MICROCMS-API-KEY': MICROCMS_API_KEY
            }
        });

        if (!response.ok) {
            throw new Error(`microCMS API Error: ${response.status}`);
        }

        const data = await response.json();
        renderSpecialGuests(data.contents);
    } catch (error) {
        console.error('期間限定キャストの取得に失敗しました:', error);
    }
}

function renderSpecialGuests(guests) {
    const grid = document.getElementById('specialGuestGrid');
    if (!grid) return;

    grid.innerHTML = ''; // 中身をクリア

    guests.forEach((guest, index) => {
        const rankNumber = 5 + index; // 5, 6, 7...と連番を付与
        const rankSymbol = '♥';

        // 写真のHTML生成
        const photoHtml = guest.photo && guest.photo.url
            ? `<img src="${guest.photo.url}" alt="${guest.name}" />`
            : '';

        // InstagramリンクのHTML生成
        const instaHtml = guest.instagram_url
            ? `<a class="insta" href="${guest.instagram_url}" target="_blank" rel="noopener">公式Instagram</a>`
            : '';

        const article = document.createElement('article');
        article.className = 'cast-item';
        article.tabIndex = 0;

        article.innerHTML = `
          <div class="card">
            <div class="card-face card-front">
              <span class="rank">${rankNumber}<br />${rankSymbol}</span>
              <span class="symbol">${rankSymbol}</span>
              <span class="title">${guest.name}</span>
              <span class="rank bottom">${rankNumber}<br />${rankSymbol}</span>
            </div>
            <div class="card-face card-back">
              ${photoHtml}
              <h3>${guest.name}</h3>
              <p>${guest.description || ''}</p>
              ${instaHtml}
            </div>
          </div>
        `;

        // タッチデバイス（スマートフォンなど）でタップ時に裏返る処理を適用
        article.addEventListener('click', () => {
            if (window.matchMedia('(hover: none)').matches) {
                article.classList.toggle('is-flipped');
            }
        });

        grid.appendChild(article);
    });
}

// ページ読み込み時にデータを取得する
window.addEventListener('load', fetchSpecialGuests);
