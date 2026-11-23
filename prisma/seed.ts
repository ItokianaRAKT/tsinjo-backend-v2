import { PrismaPg } from '@prisma/adapter-pg';
import { FoodCategory, OfferStatus, PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DEFAULT_PASSWORD = 'Tsinjo@2026';
const DAY_MS = 24 * 60 * 60 * 1000;
const photo = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=800&q=80`;

const users = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    phone: '+261320000001',
    email: 'admin@tsinjo.mg',
    fullName: 'Admin Tsinjo',
    role: Role.ADMIN,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    phone: '+261320000002',
    email: 'boulangerie@tsinjo.mg',
    fullName: 'Mireille Rasoamananjara',
    role: Role.MERCHANT,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    phone: '+261320000003',
    email: 'restaurant@tsinjo.mg',
    fullName: 'Rado Andrianaivo',
    role: Role.MERCHANT,
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    phone: '+261320000004',
    email: 'hery@tsinjo.mg',
    fullName: 'Hery Randrianasolo',
    role: Role.USER,
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    phone: '+261320000005',
    email: 'noro@tsinjo.mg',
    fullName: 'Noro Rakotomalala',
    role: Role.USER,
  },
] as const;

const merchants = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    ownerId: '00000000-0000-4000-8000-000000000002',
    businessName: 'Boulangerie Analakely',
    description: 'Pains, viennoiseries et pâtisseries cuits chaque matin.',
    address: '12 rue de l’Indépendance, Analakely, Antananarivo',
    quartier: 'Analakely',
    latitude: -18.9092,
    longitude: 47.5237,
    isVerified: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    ownerId: '00000000-0000-4000-8000-000000000003',
    businessName: 'Restaurant Ivandry',
    description: 'Cuisine malgache traditionnelle et plats à emporter.',
    address: 'Lot II B 45, Ivandry, Antananarivo',
    quartier: 'Ivandry',
    latitude: -18.8616,
    longitude: 47.4847,
    isVerified: true,
  },
] as const;

const now = Date.now();

const offers = [
  {
    id: '00000000-0000-4000-8000-000000000201',
    creatorId: '00000000-0000-4000-8000-000000000002',
    merchantId: '00000000-0000-4000-8000-000000000101',
    title: 'Panier surprise boulangerie',
    description: 'Assortiment de pains et viennoiseries invendus du jour.',
    category: FoodCategory.PANIER_SURPRISE,
    price: 3500,
    originalPrice: 9000,
    quantityAvailable: 3,
    address: '12 rue de l’Indépendance, Analakely, Antananarivo',
    quartier: 'Analakely',
    latitude: -18.9092,
    longitude: 47.5237,
    pickupInHours: 20,
    expirationInHours: 44,
    images: [
      { id: '00000000-0000-4000-8000-000000000301', url: photo('photo-1509440159596-0249088772ff'), isMain: true },
      { id: '00000000-0000-4000-8000-000000000302', url: photo('photo-1555507036-ab1f4038808a'), isMain: false },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000202',
    creatorId: '00000000-0000-4000-8000-000000000002',
    merchantId: '00000000-0000-4000-8000-000000000101',
    title: 'Pain de mie et croissants du matin',
    description: 'Pain de mie nature et croissants pur beurre, DLC du jour.',
    category: FoodCategory.BOULANGERIE,
    price: 2000,
    originalPrice: 4500,
    quantityAvailable: 5,
    address: '12 rue de l’Indépendance, Analakely, Antananarivo',
    quartier: 'Analakely',
    latitude: -18.9095,
    longitude: 47.524,
    pickupInHours: 12,
    expirationInHours: 36,
    images: [
      { id: '00000000-0000-4000-8000-000000000303', url: photo('photo-1608198093002-ad4e005484ec'), isMain: true },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000203',
    creatorId: '00000000-0000-4000-8000-000000000003',
    merchantId: '00000000-0000-4000-8000-000000000102',
    title: 'Plats cuisinés à emporter',
    description: 'Riz, viande et légumes du jour, préparés dans notre cuisine.',
    category: FoodCategory.PLATS_CUISINES,
    price: 8000,
    originalPrice: 14000,
    quantityAvailable: 4,
    address: 'Lot II B 45, Ivandry, Antananarivo',
    quartier: 'Ivandry',
    latitude: -18.8616,
    longitude: 47.4847,
    pickupInHours: 16,
    expirationInHours: 28,
    images: [
      { id: '00000000-0000-4000-8000-000000000304', url: photo('photo-1546069901-ba9599a7e63c'), isMain: true },
      { id: '00000000-0000-4000-8000-000000000305', url: photo('photo-1512621776951-a57141f2eefd'), isMain: false },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000204',
    creatorId: '00000000-0000-4000-8000-000000000003',
    merchantId: '00000000-0000-4000-8000-000000000102',
    title: 'Plateau-repas Ankorondrano',
    description: 'Deux plats du chef à prix réduit, retrait avant fermeture.',
    category: FoodCategory.PLATS_CUISINES,
    price: 6500,
    originalPrice: 11000,
    quantityAvailable: 2,
    address: 'Route d’Albiot, Ankorondrano, Antananarivo',
    quartier: 'Ankorondrano',
    latitude: -18.8907,
    longitude: 47.5286,
    pickupInHours: 10,
    expirationInHours: 24,
    images: [
      { id: '00000000-0000-4000-8000-000000000306', url: photo('photo-1565299624946-b28f40a0ae38'), isMain: true },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000205',
    creatorId: '00000000-0000-4000-8000-000000000004',
    merchantId: null,
    title: 'Panier de fruits et légumes à donner',
    description: 'Fruits et légumes encore comestibles, à récupérer ce soir.',
    category: FoodCategory.PANIER_SURPRISE,
    price: 0,
    quantityAvailable: 2,
    address: 'Ambohimiandra, Antananarivo',
    quartier: 'Ambohimiandra',
    latitude: -18.8977,
    longitude: 47.5495,
    pickupInHours: 8,
    expirationInHours: 30,
    images: [
      { id: '00000000-0000-4000-8000-000000000307', url: photo('photo-1619566636858-adf3ef46400b'), isMain: true },
    ],
  },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  for (const user of users) {
    await prisma.user.upsert({
      where: { phone: user.phone },
      create: { ...user, passwordHash, isPhoneVerified: true },
      update: { fullName: user.fullName, role: user.role, isPhoneVerified: true },
    });
  }
  for (const merchant of merchants) {
    await prisma.merchant.upsert({
      where: { ownerId: merchant.ownerId },
      create: merchant,
      update: merchant,
    });
  }
  for (const offer of offers) {
    const { images, pickupInHours, expirationInHours, ...data } = offer;
    await prisma.offer.upsert({
      where: { id: offer.id },
      create: {
        ...data,
        status: OfferStatus.ACTIVE,
        pickupDeadline: new Date(now + pickupInHours * 60 * 60 * 1000),
        expirationDate: new Date(now + expirationInHours * 60 * 60 * 1000),
        images: { create: images },
      },
      update: {
        ...data,
        status: OfferStatus.ACTIVE,
        pickupDeadline: new Date(now + pickupInHours * 60 * 60 * 1000),
        expirationDate: new Date(now + expirationInHours * 60 * 60 * 1000),
        images: {
          upsert: images.map((image) => ({
            where: { id: image.id },
            create: image,
            update: { url: image.url, isMain: image.isMain },
          })),
        },
      },
    });
  }
  console.log(
    `Seed terminé : ${users.length} comptes, ${merchants.length} boutiques, ${offers.length} offres. Mot de passe : ${DEFAULT_PASSWORD}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
