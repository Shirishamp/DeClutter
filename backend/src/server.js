require('dotenv').config();
const express = require('express');
const cors = require('cors');

const healthRoutes = require('./routes/health.routes');
const dbRoutes = require('./routes/db.routes');
const authRoutes = require('./routes/auth.routes');
const filesRoutes = require('./routes/files.routes');
const searchRoutes = require('./routes/search.routes');
const accountsRoutes = require('./routes/accounts.routes');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Route mounting
app.use('/api/health', healthRoutes);
app.use('/api/db-check', dbRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/accounts', accountsRoutes);

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});