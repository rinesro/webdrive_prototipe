require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const methodOverride = require('method-override');
const connectDB = require('./config/database');
const authRoutes = require('./routes/authRoutes');
const fileRoutes = require('./routes/fileRoutes');
const multer = require('multer');


connectDB();


const app = express();


app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  
  secret: 'kunci-rahasia-yang-sangat-kuat-dan-unik-untuk-aplikasi-ini', 
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: false, 
    maxAge: 60 * 60 * 1000 
  } 
}));

app.use((req, res, next) => {
  if (req.session.notification) {
    res.locals.notification = req.session.notification;
    delete req.session.notification;
  }
  next();
});


app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


app.use(bodyParser.urlencoded({ extended: false }));


app.use(methodOverride('_method'));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Terjadi kesalahan pada server!');
});


app.use('/', authRoutes);
app.use('/', fileRoutes);

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      
      return res.status(413).json({ 
        message: 'Gagal mengunggah. Ukuran file maksimal adalah 200 MB.' 
      });
    }
  }
  
  next(err);
});


app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Terjadi kesalahan pada server!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berhasil dijalankan di http://localhost:${PORT}`);
});
