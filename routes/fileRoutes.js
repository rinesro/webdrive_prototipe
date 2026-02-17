const express = require('express');
const router = express.Router();
const multer = require('multer');
const fileController = require('../controllers/fileController');

const isLoggedIn = (req, res, next) => {
    if (req.session.user) return next();
    res.redirect('/login');
};

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { 
        fileSize: 200 * 1024 * 1024 
    } 
});
router.get('/api/preview/:id', isLoggedIn, fileController.getPreviewData);

router.get('/upload', isLoggedIn, fileController.getDriveContents);
router.get('/folder/:folderId', isLoggedIn, fileController.getDriveContents);

router.post('/create-folder', isLoggedIn, fileController.createFolder);
router.post('/upload-file', isLoggedIn, upload.single('fileToUpload'), fileController.uploadFile);
router.get('/view/:id', isLoggedIn, fileController.viewFile);
router.delete('/delete/:id', isLoggedIn, fileController.deleteItem);
router.get('/download/:id', isLoggedIn, fileController.downloadFile);

router.post('/upload-folder', isLoggedIn, upload.array('filesInFolder', 100), fileController.uploadFolder);

router.get('/search', isLoggedIn, fileController.searchItems);
router.post('/share/:itemId', isLoggedIn, fileController.shareItem);
router.put('/rename/:itemId', isLoggedIn, fileController.renameItem);

router.get('/api/folders', isLoggedIn, fileController.getUserFolders);
router.put('/move/:itemId', isLoggedIn, fileController.moveItem);

router.get('/shared', isLoggedIn, fileController.getSharedWithMe);

router.get('/download/folder/:id', isLoggedIn, fileController.downloadFolder);

module.exports = router;
