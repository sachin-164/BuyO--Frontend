// Fetch and inject header, then call initHeader
fetch('header.html')
  .then(res => res.text())
  .then(data => {
    document.getElementById('header-placeholder').innerHTML = data;
    initHeader(); // Call this AFTER header is inserted
  });

function initHeader() {
  // Toggle mobile menu
  const mobileMenuButton = document.querySelector('.mobile-menu-button');
  const mobileMenu = document.querySelector('.mobile-menu');

  if (mobileMenuButton && mobileMenu) {
    mobileMenuButton.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
    });
  }

  // ✅ Update badge counts (you can fetch from localStorage or backend)
  const cartBadge = document.querySelector('.cart-badge');
  const wishlistBadge = document.querySelector('.wishlist-badge');

  const cartCount = 0;      // Replace this with dynamic value
  const wishlistCount = 0;  // Replace this with dynamic value

  // Show count or hide badge if 0
  if (cartBadge) {
    cartBadge.textContent = cartCount;
    cartBadge.style.display = cartCount > 0 ? 'flex' : 'none';
  }

  if (wishlistBadge) {
    wishlistBadge.textContent = wishlistCount;
    wishlistBadge.style.display = wishlistCount > 0 ? 'flex' : 'none';
  }
}
