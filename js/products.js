document.addEventListener("DOMContentLoaded", () => {
  const products = [
    {
      name: "HP Victus Gaming Laptop",
      brand: "HP",
      price: 75000,
      mrp: 90000,
      discount: "-17%",
      image: "assets/images/hp victus.jpg"
    },
    {
      name: "Nike Air Force 1",
      brand: "Nike",
      price: 4999,
      mrp: 7999,
      discount: "-38%",
      image: "assets/images/nike-af1.jpg"
    }
    // Add more products
  ];

  const productGrid = document.getElementById("product-grid");

  products.forEach(prod => {
    const card = document.createElement("div");
    card.classList.add("product-card");
    card.innerHTML = `
      <span class="discount-badge">${prod.discount}</span>
      <img src="${prod.image}" alt="${prod.name}">
      <div class="product-info">
        <p class="brand">${prod.brand}</p>
        <p class="name">${prod.name}</p>
        <p class="price">₹${prod.price.toLocaleString()} 
          <span class="mrp">₹${prod.mrp.toLocaleString()}</span>
        </p>
      </div>
    `;
    card.addEventListener("click", () => {
      window.location.href = `product-details.html?name=${encodeURIComponent(prod.name)}`;
    });
    productGrid.appendChild(card);
  });
});
