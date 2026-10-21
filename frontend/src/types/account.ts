export type UserRole = "customer" | "admin";

export interface User {
  id: number;
  name: string;
  email: string;
  isVerified: boolean;
  role: UserRole;
  isAdmin: boolean;
}

export interface AuthMeResponse {
  success: true;
  user: User;
}

export interface LoginResponse {
  success: true;
  message?: string;
  token: string;
  user: User;
}

export interface MessageResponse {
  success: boolean;
  message: string;
  errors?: string[];
}

export interface Address {
  id: number;
  userId?: number;
  label?: string | null;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AddressListResponse {
  success: true;
  count: number;
  addresses: Address[];
}

export interface AddressMutationResponse {
  success: true;
  message?: string;
  address: Address;
}

export interface AddressDeleteResponse {
  success: true;
  message: string;
}

export type AddressInput = Omit<Address, "id" | "userId" | "createdAt" | "updatedAt">;
