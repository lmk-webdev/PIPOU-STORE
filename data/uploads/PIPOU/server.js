const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const app = express();

const upload = multer({ dest: path.join(__dirname, 'public/fonds') });
const PORT = 3000;
const ARTICLES_FILE = path.join(__dirname, 'articles.json');
const FOND_FILE = path.join(__dirname, 'fond.json');

// 🔐 Configuration session
app.use(session({
  secret: 'pipou-secret-key',
  resave: false,
  saveUninitialized: true
}));

// ✅ Middleware avec taille augmentée (10 Mo)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// 🔐 Mot de passe d'accès
const ADMIN_PASSWORD = 'pipou123';

// 🔒 Protection de admin.html
app.get('/admin.html', (req, res, next) => {
  if (req.session.authenticated) {
    return next();
  }
  return res.redirect('/login.html');
});

// 🔐 Route de login
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    res.sendStatus(200);
  } else {
    res.sendStatus(401);
  }
});

// 🔓 Déconnexion
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

// 📄 Lire les articles
app.get('/articles.json', (req, res) => {
  fs.readFile(ARTICLES_FILE, 'utf-8', (err, data) => {
    if (err) return res.status(500).send('Erreur lecture articles');
    res.json(JSON.parse(data || '[]'));
  });
});

// ➕ Ajouter un article
app.post('/articles', (req, res) => {
  const nouvelArticle = req.body;

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

// ✏️ Modifier un article
app.put('/articles/:index', (req, res) => {
  const articles = JSON.parse(fs.readFileSync(ARTICLES_FILE, 'utf-8'));
  const index = parseInt(req.params.index);

  if (index >= 0 && index < articles.length) {
    articles[index] = req.body;
    fs.writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 2));
    res.json({ message: 'Article modifié avec succès' });
  } else {
    res.status(404).json({ error: 'Article introuvable' });
  }
});

// 🗑️ Supprimer un article
app.delete('/articles/:index', (req, res) => {
  const index = parseInt(req.params.index);
  fs.readFile(ARTICLES_FILE, 'utf-8', (err, data) => {
    if (err) return res.status(500).send('Erreur lecture');

    let articles = [];
    try {
      articles = JSON.parse(data);
    } catch (_) {
      return res.status(500).send('Fichier articles corrompu');
    }

    if (index >= 0 && index < articles.length) {
      articles.splice(index, 1);
      fs.writeFile(ARTICLES_FILE, JSON.stringify(articles, null, 2), (err) => {
        if (err) return res.status(500).send('Erreur suppression');
        res.json({ message: 'Article supprimé avec succès' });
      });
    } else {
      res.status(404).json({ error: 'Article introuvable' });
    }
  });
});

// 🎨 Lire fond d'écran
app.get('/fond', (req, res) => {
  fs.readFile(FOND_FILE, 'utf-8', (err, data) => {
    if (err) return res.json({ background: '#f2f2f2' });
    try {
      const fond = JSON.parse(data);
      res.json(fond);
    } catch {
      res.json({ background: '#f2f2f2' });
    }
  });
});

// 🎨 Modifier fond
app.post('/fond', (req, res) => {
  const fond = req.body;
  fs.writeFile(FOND_FILE, JSON.stringify(fond, null, 2), (err) => {
    if (err) return res.status(500).send('Erreur sauvegarde fond');
    res.json({ message: 'Fond mis à jour' });
  });
});

// 🖼️ Upload d'une image de fond
app.post('/upload-fond', upload.single('fond'), (req, res) => {
  const imagePath = `/fonds/${req.file.filename}`;
  fs.writeFileSync(FOND_FILE, JSON.stringify({ background: `url(${imagePath})` }, null, 2));
  res.json({ message: 'Fond uploadé', path: imagePath });
});

// ✅ Démarrer serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur démarré : http://localhost:${PORT}`);
});
