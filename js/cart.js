document.addEventListener('DOMContentLoaded', function () {

    // ---------- BADGE UPDATE ----------
    function updateCartBadge() {
        const cartBadge = document.querySelector('.cart-badge');

        // Get cart count from localStorage
        const cartItems = JSON.parse(localStorage.getItem('cart')) || [];

        if (cartBadge) {
            cartBadge.textContent = cartItems.length;
            cartBadge.style.display = cartItems.length > 0 ? 'flex' : 'none';
        }
    }

    // ---------- CART PAGE FUNCTIONS ----------
    function updateCartTotals() {
        let subtotal = 0;
        const cartItems = document.querySelectorAll('.cart-item:not(.template)'); // Ignore template

        cartItems.forEach(item => {
            const price = parseFloat(item.querySelector('.current-price').textContent.replace('$', '').replace('₹', '')) || 0;
            const qty = parseInt(item.querySelector('.quantity-display').textContent) || 0;
            subtotal += price * qty;
        });

        const tax = subtotal * 0.08;
        const total = subtotal + tax;

        document.getElementById('subtotal').textContent = `$${subtotal.toFixed(2)}`;
        document.getElementById('tax').textContent = `$${tax.toFixed(2)}`;
        document.getElementById('total').textContent = `$${total.toFixed(2)}`;

        saveCartState();
    }

    function updateItemCount() {
        const cartItems = document.querySelectorAll('.cart-item:not(.template)'); // Ignore template
        const itemCount = cartItems.length;
        document.getElementById('item-count').textContent = itemCount;

        // Show/Hide empty cart section
        if (itemCount === 0) {
            document.getElementById('cart-items').classList.add('hidden');
            document.getElementById('empty-cart').classList.remove('hidden');
        } else {
            document.getElementById('cart-items').classList.remove('hidden');
            document.getElementById('empty-cart').classList.add('hidden');
        }

        saveCartState();
        updateCartBadge();
    }

    function saveCartState() {
        const items = [];
        document.querySelectorAll('.cart-item:not(.template)').forEach(item => { // Ignore template
            const id = item.getAttribute('data-id');
            const name = item.querySelector('h3').textContent;
            const price = parseFloat(item.querySelector('.current-price').textContent.replace('$', '').replace('₹', '')) || 0;
            const image = item.querySelector('img').src;
            const qty = parseInt(item.querySelector('.quantity-display').textContent) || 0;

            items.push({ id, name, price, image, qty });
        });
        localStorage.setItem('cart', JSON.stringify(items));
    }

    // ---------- QUANTITY BUTTONS ----------
    document.querySelectorAll('.quantity-btn').forEach(button => {
        button.addEventListener('click', function () {
            const cartItem = this.closest('.cart-item');
            const quantityDisplay = cartItem.querySelector('.quantity-display');
            let quantity = parseInt(quantityDisplay.textContent);

            if (this.textContent === '+') {
                quantity++;
            } else if (this.textContent === '-' && quantity > 1) {
                quantity--;
            }

            quantityDisplay.textContent = quantity;
            updateCartTotals();
        });
    });

    // ---------- REMOVE ITEM ----------
    document.querySelectorAll('.remove-btn').forEach(button => {
        button.addEventListener('click', function () {
            const cartItem = this.closest('.cart-item');
            cartItem.style.opacity = '0';
            cartItem.style.transform = 'translateX(50px)';

            setTimeout(() => {
                cartItem.remove();
                updateCartTotals();
                updateItemCount();
            }, 300);
        });
    });

    // ---------- INITIAL LOAD ----------
    updateCartTotals();
    updateItemCount();
    updateCartBadge();
});
