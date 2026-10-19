import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the app shell', () => {
  render(<App />);

  expect(screen.getByText(/declutter/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /connect google drive/i })).toBeInTheDocument();
});
