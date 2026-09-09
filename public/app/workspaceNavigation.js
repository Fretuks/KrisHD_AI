import {post} from './api.js?v=20260909-account-controls';

// Every page gets this control from the same server-rendered header.
for (const button of document.querySelectorAll('[data-sign-out]')) {
    button.addEventListener('click', async () => {
        button.disabled = true;
        const result = await post('/logout', {});
        if (result.error) {
            button.disabled = false;
            const notice = document.querySelector('#shellNotice');
            notice.textContent = result.error;
            notice.classList.remove('hidden');
            return;
        }
        location.assign('/');
    });
}
