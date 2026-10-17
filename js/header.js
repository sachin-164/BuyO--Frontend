// header.js
fetch('header.html')
  .then(res => res.text())
  .then(data => {
    document.getElementById('header-placeholder').innerHTML = data;
    initHeader(); // Call this AFTER the header is inserted
  });

function initHeader() {
    const mobileMenuButton = document.querySelector('.mobile-menu-button');
    const mobileMenu = document.querySelector('.mobile-menu');

    if (mobileMenuButton && mobileMenu) {
        mobileMenuButton.addEventListener('click', () => {
            mobileMenu.classList.toggle('hidden');
        });
        document.addEventListener('click', (event) => {
            const isMenuOpen = !mobileMenu.classList.contains('hidden');
            const isClickInsideMenu = mobileMenu.contains(event.target);
            const isClickOnButton = mobileMenuButton.contains(event.target);
            if (isMenuOpen && !isClickInsideMenu && !isClickOnButton) {
                mobileMenu.classList.add('hidden');
            }
        });
    }

    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const authText = document.getElementById('auth-text');
    const loginProfileLink = document.getElementById('login-profile-link');
    const signupLink = document.getElementById('signup-link');
    const logoutLink = document.getElementById('logout-link');

    if (isLoggedIn) {
        if (authText) {
            authText.textContent = 'Profile';
        }
        if (loginProfileLink) {
            loginProfileLink.textContent = 'My Profile';
            loginProfileLink.href = 'profile.html';
            loginProfileLink.style.display = 'block';
        }
        if (signupLink) {
            signupLink.style.display = 'none';
        }
        if (logoutLink) {
            logoutLink.style.display = 'block';
            logoutLink.addEventListener('click', (e) => {
                e.preventDefault();
                localStorage.removeItem('isLoggedIn');
                localStorage.removeItem('token');
                window.location.href = 'index.html';
            });
        }
    } else {
        if (authText) {
            authText.textContent = 'Login';
        }
        if (loginProfileLink) {
            loginProfileLink.textContent = 'Login';
            loginProfileLink.href = 'login.html';
            loginProfileLink.style.display = 'block';
        }
        if (signupLink) {
            signupLink.style.display = 'block';
        }
        if (logoutLink) {
            logoutLink.style.display = 'none';
        }
    }
}