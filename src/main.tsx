import React from 'react';
import ReactDOM from 'react-dom/client';
import CashFlow from './CashFlow';
import Gate from './Gate';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Gate>
      <CashFlow />
    </Gate>
  </React.StrictMode>
);
