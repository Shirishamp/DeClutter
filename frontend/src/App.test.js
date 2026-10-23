import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

test('renders the app shell', () => {
  render(<App />);

  expect(screen.getByText(/declutter/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /connect google drive/i })).toBeInTheDocument();
});

test('browses and sorts photos and videos across connected accounts', async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn((url) => {
    if (url.endsWith('/api/health')) {
      return Promise.resolve({ json: () => Promise.resolve({ message: 'Connected' }) });
    }
    if (url.endsWith('/api/accounts')) {
      return Promise.resolve({ json: () => Promise.resolve({ accounts: [] }) });
    }
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              fileName: 'z-video.mp4',
              availableIn: [
                {
                  fileId: 'video-id',
                  accountId: 2,
                  fileType: 'video/mp4',
                  fileSize: 2048,
                  modifiedDate: '2025-01-01T00:00:00.000Z',
                  provider: 'google_drive',
                  accountLabel: 'Personal',
                },
              ],
            },
            {
              fileName: 'a-photo.jpg',
              availableIn: [
                {
                  fileId: 'photo-id',
                  accountId: 1,
                  fileType: 'image/jpeg',
                  fileSize: 4096,
                  modifiedDate: '2025-02-01T00:00:00.000Z',
                  provider: 'google_drive',
                  accountLabel: 'College',
                },
              ],
            },
          ],
        }),
    });
  });

  try {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /view photos & videos from all accounts/i }));

    expect(await screen.findByText('z-video.mp4')).toBeInTheDocument();
    expect(screen.getByText('a-photo.jpg')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:5000/api/search?media=true');

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'type' } });
    const names = Array.from(container.querySelectorAll('.media-result-item .result-filename'));
    expect(names.map((element) => element.textContent)).toEqual(['a-photo.jpg', 'z-video.mp4']);

    fireEvent.click(screen.getByRole('button', { name: /more actions for a-photo.jpg in college/i }));
    expect(screen.getByRole('menuitem', { name: /view in drive/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /move \(keep original\)/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /move to trash/i })).toBeInTheDocument();
  } finally {
    global.fetch = originalFetch;
  }
});
