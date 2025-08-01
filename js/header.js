fetch('header.html')
  .then(res => res.text())
  .then(data => {
    document.getElementById('header-placeholder').innerHTML = data;
    initHeader(); // Call this AFTER header is inserted
  });


function searchProduct(){
  const input = document.getElementById("searchbox")
                      .value.toLowerCase();
  const bodyText = document.body.innerText.toLowerCase();
  if (!input.trim()) {
    alert("Please enter something to search.");
    return;
  }
  if (bodyText.includes(input)) {
    alert("Match found for: " + input);
  } else {
    alert("No results found for: " + input);
  }
}



// This function should be called after the header HTML is loaded into the page.
function initHeader() {
    const mobileMenuButton = document.querySelector('.mobile-menu-button');
    const mobileMenu = document.querySelector('.mobile-menu');

    // Ensure elements exist before adding listeners
    if (mobileMenuButton && mobileMenu) {
        // 1. Toggle menu when hamburger button is clicked
        mobileMenuButton.addEventListener('click', () => {
            mobileMenu.classList.toggle('hidden');
        });

        // 2. Add "click outside to close" functionality
        document.addEventListener('click', (event) => {
            const isMenuOpen = !mobileMenu.classList.contains('hidden');
            // Check if the click was outside the menu AND outside the button
            const isClickInsideMenu = mobileMenu.contains(event.target);
            const isClickOnButton = mobileMenuButton.contains(event.target);

            if (isMenuOpen && !isClickInsideMenu && !isClickOnButton) {
                mobileMenu.classList.add('hidden'); // Close the menu
            }
        });
    }

    // Update badge counts (can be fetched from localStorage or backend)
    const cartBadge = document.querySelector('.cart-badge');
    const wishlistBadge = document.querySelector('.wishlist-badge');

    const cartCount = 1;      
    const wishlistCount = 2;  

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





