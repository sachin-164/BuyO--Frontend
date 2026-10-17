document.addEventListener("DOMContentLoaded", function () {
  
  const imageTypeSelect = document.getElementById("imageType");
  const imageUrlGroup = document.getElementById("imageUrlGroup");
  const imageFileGroup = document.getElementById("imageFileGroup");

  const mrpInput = document.getElementById("mrp");
  const priceInput = document.getElementById("price");
  const discountInput = document.getElementById("discount");

  // Toggle image input based on selection
  imageTypeSelect.addEventListener("change", function () {
    if (this.value === "url") {
      imageUrlGroup.style.display = "block";
      imageFileGroup.style.display = "none";
    } else {
      imageUrlGroup.style.display = "none";
      imageFileGroup.style.display = "block";
    }
  });

  // Auto calculate discount
  function calculateDiscount() {
    const mrp = parseFloat(mrpInput.value);
    const price = parseFloat(priceInput.value);

    if (!isNaN(mrp) && !isNaN(price) && mrp > 0 && price < mrp) {
      const discount = Math.round(((mrp - price) / mrp) * 100);
      discountInput.value = discount + "%";
    } else {
      discountInput.value = "";
    }
  }

  mrpInput.addEventListener("input", calculateDiscount);
  priceInput.addEventListener("input", calculateDiscount);

  // Submit action
  document.getElementById("addProductBtn").addEventListener("click", function () {
    alert("Product added successfully (connect to backend here)");
  });
});
