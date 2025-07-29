const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
require('dotenv').config();

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = 3000;
const ARTICLES_FILE = path.join(__dirname, 'articles.json');
const FOND_FILE = path.join(__dirname, 'fond.json');

// 🔐 Mot de passe admin
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Sécurité HTTP headers (CSP adapté pour inline scripts)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        objectSrc: ["'none'"],
      },
    },
  })
);

// Body parser (doit être avant les routes)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Sessions (doit être avant les routes)
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

// Protéger les tentatives de connexion
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: "Trop de tentatives. Réessaie dans 15 minutes.",
});

// 📁 Assurer que le dossier "fonds" existe
const fondsPath = path.join(__dirname, 'public/fonds');
if (!fs.existsSync(fondsPath)) fs.mkdirSync(fondsPath, { recursive: true });

const upload = multer({ dest: fondsPath });

// Middleware de protection (authentification)
function requireLogin(req, res, next) {
  if (req.session.authenticated) return next();
  res.redirect('/login.html');
}

// Protection spéciale pour admin.html
app.use((req, res, next) => {
  if (req.path === '/admin.html' && !req.session.authenticated) {
    return res.redirect('/login.html');
  }
  next();
});

// Fichiers statiques (CSS, JS, images, login.html...)
app.use(express.static(path.join(__dirname, 'public')));

// --- ROUTES ---

// Login avec protection rate limit
app.post('/login', loginLimiter, (req, res) => {
  try {
    const { password } = req.body;
    console.log('Mot de passe reçu:', password);
    console.log('Mot de passe attendu:', ADMIN_PASSWORD);

    if (!password) {
      return res.status(400).send('Mot de passe manquant');
    }

    if (password === ADMIN_PASSWORD) {
      req.session.authenticated = true;
      return res.sendStatus(200);
    } else {
      return res.status(401).send('Mot de passe incorrect !');
    }
  } catch (err) {
    console.error('Erreur dans /login:', err);
    res.status(500).send('Erreur serveur');
  }
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

// Lire articles (protégé)
app.get('/articles.json', requireLogin, (req, res) => {
  fs.readFile(ARTICLES_FILE, 'utf-8', (err, data) => {
    if (err) return res.status(500).send('Erreur lecture articles');
    res.json(JSON.parse(data || '[]'));
  });
});

// Ajouter article
app.post('/articles', requireLogin, (req, res) => {
  const nouvelArticle = req.body;
  nouvelArticle.id = Date.now();

  fs.readFile(ARTICLES_FILE, 'utf-8', (err, data) => {
    let articles = [];
    if (!err && data) {
      try {
        articles = JSON.parse(data);
      } catch (_) {}
    }

    articles.push(nouvelArticle);

    fs.writeFile(ARTICLES_FILE, JSON.stringify(articles, null, 2), (err) => {
      if (err) return res.status(500).send('Erreur sauvegarde');
      res.status(201).json({ message: 'Article ajouté' });
    });
  });
});

// Modifier article
app.put('/articles/:id', requireLogin, (req, res) => {
  const articles = JSON.parse(fs.readFileSync(ARTICLES_FILE, 'utf-8'));
  const id = parseInt(req.params.id);

  const index = articles.findIndex(a => a.id === id);
  if (index !== -1) {
    articles[index] = { ...req.body, id };
    fs.writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 2));
    res.json({ message: 'Article modifié avec succès' });
  } else {
    res.status(404).json({ error: 'Article introuvable' });
  }
});

// Supprimer article
app.delete('/articles/:id', requireLogin, (req, res) => {
  const id = parseInt(req.params.id);
  fs.readFile(ARTICLES_FILE, 'utf-8', (err, data) => {
    if (err) return res.status(500).send('Erreur lecture');

    let articles = [];
    try {
      articles = JSON.parse(data);
    } catch (_) {
      return res.status(500).send('Fichier articles corrompu');
    }

    const newArticles = articles.filter(a => a.id !== id);
    if (newArticles.length === articles.length) {
      return res.status(404).json({ error: 'Article introuvable' });
    }

    fs.writeFile(ARTICLES_FILE, JSON.stringify(newArticles, null, 2), (err) => {
      if (err) return res.status(500).send('Erreur suppression');
      res.json({ message: 'Article supprimé avec succès' });
    });
  });
});

// Lire fond
app.get('/fond', requireLogin, (req, res) => {
  fs.readFile(FOND_FILE, 'utf-8', (err, data) => {
    if (err) return res.json({ background: '#f2f2f2' });
    try {
      res.json(JSON.parse(data));
    } catch {
      res.json({ background: '#f2f2f2' });
    }
  });
});

// Changer fond
app.post('/fond', requireLogin, (req, res) => {
  fs.writeFile(FOND_FILE, JSON.stringify(req.body, null, 2), (err) => {
    if (err) return res.status(500).send('Erreur sauvegarde fond');
    res.json({ message: 'Fond mis à jour' });
  });
});

// Upload image fond
app.post('/upload-fond', requireLogin, upload.single('fond'), (req, res) => {
  const imagePath = `/fonds/${req.file.filename}`;
  fs.writeFileSync(FOND_FILE, JSON.stringify({ background: `url(${imagePath})` }, null, 2));
  res.json({ message: 'Fond uploadé', path: imagePath });
});

// Génération description
app.get('/generate-description', requireLogin, (req, res) => {
  const { nom } = req.query;
  const description = `Le produit "${nom}" allie style, originalité et confort. Un indispensable pour affirmer ton look.`;
  res.json({ description });
});

// Check session pour admin.html
app.get('/check-session', (req, res) => {
  if (req.session.authenticated) {
    res.sendStatus(200);
  } else {
    res.sendStatus(401);
  }
});

// Lancer le serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur en ligne : http://localhost:${PORT}`);
});
