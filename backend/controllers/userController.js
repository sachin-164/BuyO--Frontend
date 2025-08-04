// Signup function
const signup = (req, res) => {
  res.json({ message: "Signup route working!" });
};

// Login function
const login = (req, res) => {
  res.json({ message: "Login route working!" });
};

module.exports = { signup, login };
