import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { MarylandCaregiverPage } from './MarylandCaregiverPage';
import { SchoolProgramPage, SchoolAuth, SchoolDashboard } from './SchoolPortal';
import { CaregiverAuthProvider } from './caregiverAuth';
import './styles.css';

const path=window.location.pathname;
const Root=path.startsWith('/school-auth')?SchoolAuth:path.startsWith('/school-dashboard')?SchoolDashboard:path.startsWith('/school/')?SchoolProgramPage:(path.startsWith('/caregiver-jobs/maryland')||path.startsWith('/join/'))?MarylandCaregiverPage:App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><CaregiverAuthProvider><Root /></CaregiverAuthProvider></React.StrictMode>
);
