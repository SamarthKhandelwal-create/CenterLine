import QRCode from 'qrcode';

/**
 * QR as an inline SVG data URI. The payload is ONLY the credential token — never a
 * name, a centre, or a URL — so a dropped card identifies nobody.
 */
export async function qrSvgDataUri(token: string): Promise<string> {
  const svg = await QRCode.toString(token, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 300,
  });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
