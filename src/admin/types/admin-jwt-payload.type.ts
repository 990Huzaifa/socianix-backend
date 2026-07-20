export type AdminJwtPayload = {
  sub: string;
  email: string;
  type: 'admin';
  role: string;
};
