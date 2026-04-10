import express from 'express';
import apiRouter from './routes/index.js';

const app = express();
app.use(express.json());
app.use('/api', apiRouter);

app.get('/', (_req, res) => res.json({ message: 'Node API running' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
