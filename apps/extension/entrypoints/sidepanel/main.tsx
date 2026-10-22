import React from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from '../../components/Panel';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Vclarity panel root is missing');
createRoot(root).render(<Panel />);
