import axios from 'axios';
import { io } from 'socket.io-client';

// IDE API key injected by PHP (window.IDE_KEY) into the page
const IDE_KEY = window.IDE_KEY || '';

export const API_BASE = '';

export const api = axios.create({
  baseURL: '/api',
  headers: { 'x-ide-key': IDE_KEY },
});

export const socket = io(window.location.origin, {
  path: '/replit/socket.io/',
  transports: ['websocket', 'polling'],
  auth: { ideKey: IDE_KEY },
});

export default api;
