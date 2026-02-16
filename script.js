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
