const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const fileController = require('../controllers/fileController');

const isLoggedIn = (req, res, next) => {
    if (req.session.user) {
        return next(); 
    }
    res.redirect('/login'); 
};

router.get('/register', authController.getRegisterPage);
router.get('/login', authController.getLoginPage);
router.post('/register', authController.registerUser);
router.post('/login', authController.loginUser);

router.get('/upload', isLoggedIn, fileController.getDriveContents);
router.get('/profile', isLoggedIn, authController.getProfilePage);
router.get('/logout', isLoggedIn, authController.logoutUser);

router.get('/', (req, res) => {
    if (req.session.user) {
        res.redirect('/upload');
    } else {
        res.redirect('/login');
    }
});

module.exports = router;
