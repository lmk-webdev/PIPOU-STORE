const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  console.error('⚠️ Veuillez définir ADMIN_PASSWORD et SESSION_SECRET dans .env');
  process.exit(1);
}

// Redis setup for session store
const RedisStore = require('connect-redis').default; // <-- correction ici
const { createClient } = require('redis');

const redisClient = createClient({
  url: process.env.REDIS_URL,
});
redisClient.connect().catch(console.error);

const redisStore = new RedisStore({
  client: redisClient,
  prefix: "sess:",  // optionnel, pour préfixer les clés dans Redis
});

app.use(
  session({
    store: redisStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // true en prod avec HTTPS
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 2,
    },
  })
);


// Sécurité HTTP headers (CSP adapté)
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

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiter login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Trop de tentatives. Réessaie dans 15 minutes.",
});

// Dossier pour les fonds
const fondsPath = path.join(__dirname, 'fonds');
const ensureDirExists = async (dir) => {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
};
ensureDirExists(fondsPath);

// Multer configuration upload image
const upload = multer({
  dest: fondsPath,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === 'image/jpeg' ||
      file.mimetype === 'image/png' ||
      file.mimetype === 'image/gif'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Seulement les images jpg, png, gif sont acceptées'));
    }
  },
});

// Middleware auth
function requireLogin(req, res, next) {
  if (req.session.authenticated) return next();
  res.status(401).json({ error: 'Non authentifié' });
}

// Protection admin.html
app.use((req, res, next) => {
  if (req.path === '/admin.html' && !req.session.authenticated) {
    return res.redirect('/login.html');
  }
  next();
});

// Fichiers statiques (HTML, CSS, JSON, images...)
app.use(express.static(path.join(__dirname, 'public')));

// --- ROUTES ---

// Login
app.post('/login', loginLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Mot de passe manquant' });
    if (password === ADMIN_PASSWORD) {
      req.session.authenticated = true;
      return res.sendStatus(200);
    }
    res.status(401).json({ error: 'Mot de passe incorrect' });
  } catch (err) {
    console.error('Erreur dans /login:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

// Ajouter article
const ARTICLES_FILE = path.join(__dirname, 'public/articles.json');

app.post(
  '/articles',
  requireLogin,
  [
    body('nom').isString().notEmpty(),
    body('prix').isFloat({ gt: 0 }),
    body('description').optional().isString(),
    body('categorie').isString().notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const nouvelArticle = req.body;
      nouvelArticle.id = Date.now();

      let articles = [];
      try {
        const data = await fs.readFile(ARTICLES_FILE, 'utf-8');
        articles = JSON.parse(data);
      } catch (_) {}

      articles.push(nouvelArticle);
      await fs.writeFile(ARTICLES_FILE, JSON.stringify(articles, null, 2));
      res.status(201).json({ message: 'Article ajouté' });
    } catch (err) {
      console.error('Erreur sauvegarde article:', err);
      res.status(500).json({ error: 'Erreur sauvegarde article' });
    }
  }
);

// Modifier article
app.put(
  '/articles/:id',
  requireLogin,
  [
    body('nom').isString().notEmpty(),
    body('prix').isFloat({ gt: 0 }),
    body('description').optional().isString(),
    body('categorie').isString().notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const id = parseInt(req.params.id);
      let articles = [];
      try {
        const data = await fs.readFile(ARTICLES_FILE, 'utf-8');
        articles = JSON.parse(data);
      } catch (_) {
        return res.status(500).json({ error: 'Erreur lecture articles' });
      }

      const index = articles.findIndex(a => a.id === id);
      if (index === -1) return res.status(404).json({ error: 'Article introuvable' });

      articles[index] = { ...req.body, id };
      await fs.writeFile(ARTICLES_FILE, JSON.stringify(articles, null, 2));
      res.json({ message: 'Article modifié avec succès' });
    } catch (err) {
      console.error('Erreur modification article:', err);
      res.status(500).json({ error: 'Erreur modification article' });
    }
  }
);

// Supprimer article
app.delete('/articles/:id', requireLogin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    let articles = [];
    try {
      const data = await fs.readFile(ARTICLES_FILE, 'utf-8');
      articles = JSON.parse(data);
    } catch (_) {
      return res.status(500).json({ error: 'Erreur lecture articles' });
    }

    const newArticles = articles.filter(a => a.id !== id);
    if (newArticles.length === articles.length)
      return res.status(404).json({ error: 'Article introuvable' });

    await fs.writeFile(ARTICLES_FILE, JSON.stringify(newArticles, null, 2));
    res.json({ message: 'Article supprimé avec succès' });
  } catch (err) {
    console.error('Erreur suppression article:', err);
    res.status(500).json({ error: 'Erreur suppression article' });
  }
});

// Lire et modifier fond
const FOND_FILE = path.join(__dirname, 'public/fond.json');

app.post('/fond', requireLogin, async (req, res) => {
  try {
    await fs.writeFile(FOND_FILE, JSON.stringify(req.body, null, 2));
    res.json({ message: 'Fond mis à jour' });
  } catch (err) {
    console.error('Erreur sauvegarde fond:', err);
    res.status(500).json({ error: 'Erreur sauvegarde fond' });
  }
});

// Upload image de fond
app.post('/upload-fond', requireLogin, upload.single('fond'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });

    const imagePath = `/fonds/${req.file.filename}`;
    await fs.writeFile(FOND_FILE, JSON.stringify({ background: `url(${imagePath})` }, null, 2));
    res.json({ message: 'Fond uploadé', path: imagePath });
  } catch (err) {
    console.error('Erreur upload fond:', err);
    res.status(500).json({ error: 'Erreur upload fond' });
  }
});

// Génération description automatique
app.get('/generate-description', requireLogin, (req, res) => {
  const { nom } = req.query;
  if (!nom || typeof nom !== 'string') {
    return res.status(400).json({ error: 'Nom du produit requis' });
  }
  const description = `Le produit "${nom}" allie style, originalité et confort. Un indispensable pour affirmer ton look.`;
  res.json({ description });
});

// Check session
app.get('/check-session', (req, res) => {
  if (req.session.authenticated) {
    res.sendStatus(200);
  } else {
    res.sendStatus(401);
  }
});

// Accueil
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Démarrer serveur
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Serveur en ligne : http://localhost:${PORT}`);
});
