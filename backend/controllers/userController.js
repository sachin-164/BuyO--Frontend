const bcrypt = require("bcryptjs"); // bcryptjs is the installed dependency (pure JS, same API as bcrypt)
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const User = require("../models/user"); // Sequelize model

// ---------- Email Transporter ----------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ---------- SIGNUP FUNCTION ----------
const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Standardize email to lowercase for consistency
    const lowercaseEmail = email.toLowerCase();

    const existingUser = await User.findOne({ where: { email: lowercaseEmail } });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      name,
      email: lowercaseEmail,
      password: hashedPassword,
      isVerified: false
    });

    const token = jwt.sign({ email: lowercaseEmail }, process.env.JWT_SECRET, { expiresIn: "24h" });

    const verifyLink = `${process.env.BACKEND_URL}/api/auth/verify?token=${token}`;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: lowercaseEmail,
      subject: "Verify Your Email",
      html: `<p>Click <a href="${verifyLink}">here</a> to verify your email.</p>
             <p>This link will expire in 24 hours.</p>`
    });

    res.status(201).json({ message: "Signup successful! Check your email for verification." });

  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ message: "Signup failed", error: err.message });
  }
};

// ---------- VERIFY FUNCTION ----------
const verify = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send("Verification token is missing.");
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const lowercaseEmail = decoded.email;

    const user = await User.findOne({ where: { email: lowercaseEmail } });
    if (!user) {
      console.error(`Verification error: User with email ${lowercaseEmail} not found.`);
      return res.status(404).send("Verification failed: User not found.");
    }

    if (user.isVerified) {
      console.log(`User ${user.email} is already verified.`);
      return res.redirect(`${process.env.FRONTEND_URL}/login.html?status=already_verified`);
    }

    await User.update({ isVerified: true }, { where: { email: lowercaseEmail } });

    console.log(`✅ User ${lowercaseEmail} verified`);

    res.redirect(`${process.env.FRONTEND_URL}/login.html?status=success`);

  } catch (error) {
    console.error("Verification error:", error.message);

    if (error.name === 'TokenExpiredError') {
      return res.status(400).send("Verification link has expired. Please request a new one.");
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(400).send("Invalid verification link.");
    }
    
    res.status(500).send("An unexpected error occurred during verification.");
  }
};

// ---------- LOGIN FUNCTION ----------
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const lowercaseEmail = email.toLowerCase();

    const user = await User.findOne({ where: { email: lowercaseEmail } });
    if (!user) return res.status(400).json({ message: "User not found" });

    if (!user.isVerified) return res.status(400).json({ message: "Email not verified" });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ message: "Invalid credentials" });

    const authToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "2h" });

    res.json({ message: "Login successful", token: authToken });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Login failed", error: err.message });
  }
};

module.exports = { signup, verify, login };