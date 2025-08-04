const form = document.getElementById("productForm");
const mrpInput = document.getElementById("mrpPrice");
const sellingInput = document.getElementById("sellingPrice");
const discountInput = document.getElementById("discount");

function calculateDiscount() {
  const mrp = parseFloat(mrpInput.value);
  const selling = parseFloat(sellingInput.value);

  if (mrp && selling && selling < mrp) {
    const discount = Math.round(((mrp - selling) / mrp) * 100);
    discountInput.value = `${discount}%`;
  } else {
    discountInput.value = "";
  }
}

mrpInput.addEventListener("input", calculateDiscount);
sellingInput.addEventListener("input", calculateDiscount);

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const formData = new FormData(form);

  try {
    const response = await fetch("http://localhost:5000/products", {
      method: "POST",
      body: formData
    });

    const result = await response.json();
    alert(result.message || "Product added successfully!");

    form.reset();
    discountInput.value = "";

  } catch (error) {
    alert("Error adding product: " + error.message);
  }
});
