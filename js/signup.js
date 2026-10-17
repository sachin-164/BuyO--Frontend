document.getElementById('signupForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  const messageBox = document.getElementById('message');

  messageBox.textContent = "Processing...";
  messageBox.style.color = "blue";

  try {
    const response = await fetch(`${CONFIG.API_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });

    const data = await response.json();

    if (response.ok) {
      messageBox.textContent = "Signup successful! Please check your email for verification.";
      messageBox.style.color = "green";
      document.getElementById('signupForm').reset();
    } else {
      messageBox.textContent = data.message || "Signup failed!";
      messageBox.style.color = "red";
    }
  } catch (error) {
    console.error(error);
    messageBox.textContent = "Server error. Please try again.";
    messageBox.style.color = "red";
  }
});
