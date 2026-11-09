import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4398';

export default defineConfig({
    testDir: './e2e',
    use: { baseURL, browserName: 'chromium' },
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 4398',
        url: baseURL + '/tools/vacation-2027/',
    },
});
