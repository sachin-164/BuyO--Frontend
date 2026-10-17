const express = require("express");
const router = express.Router();

// Import the user controller
const userController = require("../controllers/userController");

// Define the API routes and link them to the controller functions
router.post("/signup", userController.signup);
router.get("/verify", userController.verify);
router.post("/login", userController.login);

module.exports = router;