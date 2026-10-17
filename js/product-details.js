const urlParams = new URLSearchParams(window.location.search);
const productId = urlParams.get("id");

// Fetch Product Details
fetch(`${CONFIG.API_URL}/products/${productId}`)
  .then(async (res) => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Product not found");
    return data;
  })
  .then(({ product }) => {
    // Basic info
    document.getElementById("product-name").textContent = product.name;
    document.getElementById("product-brand").textContent = product.category || "";
    document.getElementById("product-description").textContent = product.description || "";

    // Prices (schema: mrpPrice / sellingPrice; discount is derived, not stored)
    document.getElementById("product-price").textContent = `₹${product.sellingPrice}`;
    document.getElementById("product-mrp").textContent = product.mrpPrice > product.sellingPrice
      ? `₹${product.mrpPrice}`
      : "";
    document.getElementById("product-discount").textContent = product.mrpPrice > product.sellingPrice
      ? `-${Math.round(((product.mrpPrice - product.sellingPrice) / product.mrpPrice) * 100)}%`
      : "";

    // Images (schema stores one image URL; gallery shows it as main + single thumbnail)
    const images = product.image ? [product.image] : [];
    if (images.length) document.getElementById("main-img").src = images[0];

    const thumbnailContainer = document.getElementById("thumbnail-container");
    images.forEach((img) => {
      const thumb = document.createElement("img");
      thumb.src = img;
      thumb.onclick = () => (document.getElementById("main-img").src = img);
      thumbnailContainer.appendChild(thumb);
    });

    // Add to Cart
    document.querySelector(".cart-btn").addEventListener("click", () => {
      fetch(`${CONFIG.API_URL}/cart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, qty: 1 })
      })
        .then((res) => res.json())
        .then((data) => alert(`🔒 ${data.message || "Added to Cart!"}`))
        .catch(() => alert("⚠️ Could not add to cart. Is the server running?"));
    });

    // Add to Wishlist
    document.querySelector(".wishlist-btn").addEventListener("click", () => {
      fetch(`${CONFIG.API_URL}/wishlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId })
      })
        .then((res) => res.json())
        .then((data) => alert(`🤍 ${data.message || "Added to Wishlist!"}`))
        .catch(() => alert("⚠️ Could not add to wishlist. Is the server running?"));
    });

    // Buy Now (Redirect to checkout page)
    document.querySelector(".buy-btn").addEventListener("click", () => {
      window.location.href = `checkout.html?id=${productId}`;
    });
  })
  .catch((err) => {
    console.error(err);
    document.getElementById("product-description").textContent =
      "⚠️ Could not load this product. Make sure the backend is running and the product exists.";
  });
