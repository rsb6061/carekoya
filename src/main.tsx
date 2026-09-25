import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { MarylandCaregiverPage } from './MarylandCaregiverPage';
import './styles.css';

const path=window.location.pathname;
const Root=(path.startsWith('/caregiver-jobs/maryland')||path.startsWith('/join/'))?MarylandCaregiverPage:App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Root /></React.StrictMode>
);
