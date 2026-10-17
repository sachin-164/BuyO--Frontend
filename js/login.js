document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = e.target.email.value;
  const password = e.target.password.value;
  const remember = e.target.querySelector(".checkbox").checked;

  try {
    const res = await fetch(`${CONFIG.API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, remember })
    });

    const data = await res.json();
    
    if (res.ok) {
      alert("Login successful!");
      localStorage.setItem("token", data.token);
      // ✅ ADD THIS LINE: Set the login state flag
      localStorage.setItem("isLoggedIn", "true"); 
      window.location.href = "index.html"; // Redirect to home/dashboard
    } else {
      alert(data.message || "Invalid login credentials.");
    }
  } catch (err) {
    console.error(err);
    alert("Login failed. Please try again.");
  }
});