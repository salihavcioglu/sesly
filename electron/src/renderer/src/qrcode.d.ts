declare module 'qrcode' {
  const QRCode: {
    toDataURL(value: string): Promise<string>;
  };
  export default QRCode;
}
