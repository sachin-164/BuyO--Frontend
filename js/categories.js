document.addEventListener("DOMContentLoaded", () => {
  const categories = [
    { name: "New Products", image: "assets/images/categories/new product.jpg" },
    { name: "Best Deals", image: "assets/images/categories/best deal.jpg" },
    { name: "Electronics", image: "assets/images/categories/electronics.png" },
    { name: "Fashion", image: "assets/images/categories/fashion.jpg" },
    { name: "Beauty", image: "assets/images/categories/beauty.jpg" },
    { name: "Home", image: "assets/images/categories/home and living.jpg" },
    { name: "Sports", image: "assets/images/categories/sports.jpg" },
    { name: "Books", image: "assets/images/categories/books.jpg" }
  ];

  const container = document.getElementById("categories-container");

  categories.forEach(cat => {
    const card = document.createElement("div");
    card.classList.add("category-card");
    card.innerHTML = `
      <img src="${cat.image}" alt="${cat.name}">
      <h3>${cat.name}</h3>
    `;
    card.addEventListener("click", () => {
      window.location.href = `products.html?category=${encodeURIComponent(cat.name)}`;
    });
    container.appendChild(card);
  });
});
