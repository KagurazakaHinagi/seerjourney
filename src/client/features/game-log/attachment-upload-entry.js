import { uploadPresigned } from '@vercel/blob/client';
window.CampaignBlobUpload = (pathname, file, options) => uploadPresigned(pathname, file, options);
