// server.ts
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

// src/data/seedData.ts
var INITIAL_STORES = [
  {
    id: "HUB_KENNEDY",
    name: "Sede Principal Kennedy",
    address: "Carrera 79A #2-05, Kennedy, Bogot\xE1",
    coordinates: { lat: 4.6284, lng: -74.1539 },
    turboEnabled: true,
    isActive: true,
    schedule: "07:00 - 23:00",
    maxDeliveryRadiusKm: 6.5,
    vehicleMaxWeightKg: 25
  },
  {
    id: "HUB_ALAMOS",
    name: "Sede \xC1lamos / Engativ\xE1",
    address: "Calle 72 #97A-18, Engativ\xE1, Bogot\xE1",
    coordinates: { lat: 4.6934, lng: -74.1192 },
    turboEnabled: true,
    isActive: true,
    schedule: "07:00 - 23:00",
    maxDeliveryRadiusKm: 7,
    vehicleMaxWeightKg: 25
  },
  {
    id: "HUB_SUBA",
    name: "Sede Suba",
    address: "Carrera 107 #143-31, Suba, Bogot\xE1",
    coordinates: { lat: 4.7502, lng: -74.0956 },
    turboEnabled: true,
    isActive: true,
    schedule: "07:00 - 23:00",
    maxDeliveryRadiusKm: 6,
    vehicleMaxWeightKg: 25
  },
  {
    id: "HUB_CENTRO",
    name: "Sede Centro Hist\xF3rico",
    address: "Calle 11 #15-53, La Candelaria / Centro, Bogot\xE1",
    coordinates: { lat: 4.6028, lng: -74.0754 },
    turboEnabled: false,
    // Deshabilitado por defecto según requerimiento operativo
    isActive: true,
    schedule: "08:00 - 20:00",
    maxDeliveryRadiusKm: 5,
    vehicleMaxWeightKg: 15
  }
];
var INITIAL_PRODUCTS = [
  // ALIMENTOS
  {
    id: "prod-rc-maxi-15k",
    sku: "RC-MAXI-15KG",
    barcode: "7701234567890",
    name: "Royal Canin Maxi Adult Perros Grandes",
    brand: "Royal Canin",
    species: "Perro",
    category: "Alimentos",
    requiresPrescription: false,
    storageCondition: "LUGAR_FRESCO_Y_SECO",
    temperatureColdChain: false,
    price: 365e3,
    originalPrice: 41e4,
    discountPercent: 11,
    presentation: "Bulto 15 Kg",
    weightKg: 15,
    unitPriceText: "$24.333/Kg",
    image: "https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=800&auto=format&fit=crop&q=80",
    description: "Alimento completo y balanceado para perros adultos de raza grande (de 26 a 44 kg), a partir de los 15 meses hasta los 5 a\xF1os de edad.",
    stockByStore: { HUB_KENNEDY: 8, HUB_ALAMOS: 4, HUB_SUBA: 5, HUB_CENTRO: 2 },
    reservedStockByStore: { HUB_KENNEDY: 1, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-2026-RC89", expiryDate: "2027-04-15", quantity: 12 }],
    rating: 4.9,
    reviewsCount: 142,
    isLightningDeal: true,
    tags: ["alimento", "perro", "adulto", "maxi", "royal canin"]
  },
  {
    id: "prod-hills-sd-puppy",
    sku: "HILLS-SD-PUP-3KG",
    barcode: "7701234567891",
    name: "Hill's Science Diet Puppy Small Bites",
    brand: "Hill's",
    species: "Perro",
    category: "Alimentos",
    requiresPrescription: false,
    storageCondition: "LUGAR_FRESCO_Y_SECO",
    temperatureColdChain: false,
    price: 138e3,
    originalPrice: 155e3,
    discountPercent: 11,
    presentation: "Bolsa 3 Kg",
    weightKg: 3,
    unitPriceText: "$46.000/Kg",
    image: "https://images.unsplash.com/photo-1568640347023-a616a30bc3bd?w=800&auto=format&fit=crop&q=80",
    description: "Nutrici\xF3n precisa para cachorros en crecimiento con bocados peque\xF1os. Rico en DHA de aceite de pescado para un desarrollo cerebral \xF3ptimo.",
    stockByStore: { HUB_KENNEDY: 12, HUB_ALAMOS: 7, HUB_SUBA: 9, HUB_CENTRO: 4 },
    reservedStockByStore: { HUB_KENNEDY: 0, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-2026-HIL01", expiryDate: "2027-02-20", quantity: 15 }],
    rating: 4.8,
    reviewsCount: 88,
    isLightningDeal: true,
    tags: ["alimento", "cachorro", "hills", "puppy", "small bites"]
  },
  {
    id: "prod-proplan-cat-salmon",
    sku: "PP-CAT-SALM-3KG",
    barcode: "7701234567892",
    name: "Purina Pro Plan Adult Cat Salm\xF3n & Arroz",
    brand: "Pro Plan",
    species: "Gato",
    category: "Alimentos",
    requiresPrescription: false,
    storageCondition: "LUGAR_FRESCO_Y_SECO",
    temperatureColdChain: false,
    price: 124e3,
    originalPrice: 145e3,
    discountPercent: 14,
    presentation: "Bolsa 3 Kg",
    weightKg: 3,
    unitPriceText: "$41.333/Kg",
    image: "https://images.unsplash.com/photo-1548767797-d8c844163c4c?w=800&auto=format&fit=crop&q=80",
    description: "Tecnolog\xEDa OptiRenal que promueve la salud renal a largo plazo en gatos adultos. Prote\xEDna de salm\xF3n de alta digestibilidad.",
    stockByStore: { HUB_KENNEDY: 14, HUB_ALAMOS: 6, HUB_SUBA: 8, HUB_CENTRO: 3 },
    reservedStockByStore: { HUB_KENNEDY: 1, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-2026-PP44", expiryDate: "2026-11-30", quantity: 10 }],
    rating: 4.9,
    reviewsCount: 95,
    tags: ["alimento", "gato", "pro plan", "salmon", "salud renal"]
  },
  {
    id: "prod-taste-wild-wetlands",
    sku: "TOW-WET-2KG",
    barcode: "7701234567893",
    name: "Taste of the Wild Wetlands Canine Fowl",
    brand: "Taste of the Wild",
    species: "Perro",
    category: "Alimentos",
    requiresPrescription: false,
    storageCondition: "LUGAR_FRESCO_Y_SECO",
    temperatureColdChain: false,
    price: 94e3,
    originalPrice: 11e4,
    discountPercent: 15,
    presentation: "Bolsa 2 Kg",
    weightKg: 2,
    unitPriceText: "$47.000/Kg",
    image: "https://images.unsplash.com/photo-1535294435445-d7249524ef2e?w=800&auto=format&fit=crop&q=80",
    description: "F\xF3rmula libre de granos elaborada con aves asadas (pato y codorniz). Antioxidantes naturales de ar\xE1ndanos y frambuesas.",
    stockByStore: { HUB_KENNEDY: 9, HUB_ALAMOS: 5, HUB_SUBA: 4, HUB_CENTRO: 0 },
    reservedStockByStore: { HUB_KENNEDY: 0, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-2026-TOW71", expiryDate: "2027-08-10", quantity: 18 }],
    rating: 4.8,
    reviewsCount: 64,
    tags: ["alimento", "grain free", "taste of the wild", "pato"]
  },
  // FARMACIA VETERINARIA — ANTIPULGAS Y GARRAPATAS
  {
    id: "prod-nexgard-spectra-m",
    sku: "FAR-NX-SPEC-715",
    barcode: "7709876543210",
    name: "NexGard Spectra 7.5 a 15 Kg",
    brand: "Boehringer Ingelheim",
    species: "Perro",
    category: "Farmacia",
    pharmacySubcategory: "Antipulgas y garrapatas",
    requiresPrescription: false,
    icaRegistration: "Reg. ICA 10186-MV",
    activeIngredient: "Afoxolaner 37.5 mg + Milbemicina Oxima 7.5 mg",
    concentration: "37.5 mg / 7.5 mg",
    pharmaceuticalForm: "Tableta masticable sabor a carne",
    storageCondition: "TEMPERATURA_AMBIENTE",
    temperatureColdChain: false,
    price: 68500,
    originalPrice: 79e3,
    discountPercent: 13,
    presentation: "Caja x 1 Tableta Masticable",
    weightKg: 0.1,
    unitPriceText: "$68.500/Tableta",
    image: "https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=800&auto=format&fit=crop&q=80",
    description: "Tratamiento y prevenci\xF3n de infestaciones por pulgas, garrapatas, \xE1caros de la sarna y nematodos gastrointestinales. Protecci\xF3n mensual de amplio espectro.",
    authorizedInfo: "Uso veterinario. Administrar con o sin comida. No fraccionar la tableta.",
    stockByStore: { HUB_KENNEDY: 22, HUB_ALAMOS: 15, HUB_SUBA: 18, HUB_CENTRO: 8 },
    reservedStockByStore: { HUB_KENNEDY: 2, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-NX26-A1", expiryDate: "2027-09-30", quantity: 40 }],
    rating: 5,
    reviewsCount: 310,
    isLightningDeal: true,
    tags: ["nexgard", "antipulgas", "garrapatas", "desparasitante", "farmacia"]
  },
  {
    id: "prod-bravecto-1020",
    sku: "FAR-BRAV-1020",
    barcode: "7709876543211",
    name: "Bravecto Perros 10 a 20 Kg (12 Semanas)",
    brand: "MSD Salud Animal",
    species: "Perro",
    category: "Farmacia",
    pharmacySubcategory: "Antipulgas y garrapatas",
    requiresPrescription: false,
    icaRegistration: "Reg. ICA 9687-MV",
    activeIngredient: "Fluralaner 500 mg",
    concentration: "500 mg",
    pharmaceuticalForm: "Comprimido masticable",
    storageCondition: "TEMPERATURA_AMBIENTE",
    temperatureColdChain: false,
    price: 154e3,
    originalPrice: 172e3,
    discountPercent: 10,
    presentation: "Caja x 1 Comprimido (3 Meses)",
    weightKg: 0.1,
    unitPriceText: "$154.000/Comprimido",
    image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&auto=format&fit=crop&q=80",
    description: "Comprimido masticable para perros que proporciona 12 semanas completas de protecci\xF3n contra pulgas y garrapatas.",
    authorizedInfo: "Venta libre bajo supervisi\xF3n veterinaria. Conservar a temperatura inferior a 30\xB0C.",
    stockByStore: { HUB_KENNEDY: 15, HUB_ALAMOS: 10, HUB_SUBA: 12, HUB_CENTRO: 5 },
    reservedStockByStore: { HUB_KENNEDY: 0, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-BR26-90", expiryDate: "2027-11-15", quantity: 30 }],
    rating: 4.9,
    reviewsCount: 220,
    tags: ["bravecto", "fluralaner", "garrapatas", "pulgas", "farmacia"]
  },
  {
    id: "prod-simparica-trio-s",
    sku: "FAR-SIMP-TRIO-S",
    barcode: "7709876543212",
    name: "Simparica Trio 5 a 10 Kg",
    brand: "Zoetis",
    species: "Perro",
    category: "Farmacia",
    pharmacySubcategory: "Antipulgas y garrapatas",
    requiresPrescription: false,
    icaRegistration: "Reg. ICA 10562-MV",
    activeIngredient: "Sarolaner 12 mg + Moxidectina 0.24 mg + Pirantel 50 mg",
    concentration: "12 mg / 0.24 mg / 50 mg",
    pharmaceuticalForm: "Tableta palatable",
    storageCondition: "TEMPERATURA_AMBIENTE",
    temperatureColdChain: false,
    price: 64900,
    originalPrice: 74e3,
    discountPercent: 12,
    presentation: "Caja x 1 Tableta",
    weightKg: 0.08,
    unitPriceText: "$64.900/Tableta",
    image: "https://images.unsplash.com/photo-1576602976047-174e57a47881?w=800&auto=format&fit=crop&q=80",
    description: "Triple protecci\xF3n mensual contra pulgas, garrapatas y gusano del coraz\xF3n, adem\xE1s de par\xE1sitos intestinales.",
    stockByStore: { HUB_KENNEDY: 18, HUB_ALAMOS: 12, HUB_SUBA: 14, HUB_CENTRO: 6 },
    reservedStockByStore: { HUB_KENNEDY: 0, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-SIM26-14", expiryDate: "2027-05-18", quantity: 25 }],
    rating: 4.8,
    reviewsCount: 175,
    tags: ["simparica", "trio", "zoetis", "antiparasitario"]
  },
  // FARMACIA VETERINARIA — MEDICAMENTOS BAJO FÓRMULA MÉDICA OBLIGATORIA
  {
    id: "prod-apoquel-16mg",
    sku: "FAR-APOQ-16MG",
    barcode: "7709876543213",
    name: "Apoquel 16 mg Oclacitinib (Requiere F\xF3rmula)",
    brand: "Zoetis",
    species: "Perro",
    category: "Farmacia",
    pharmacySubcategory: "Dermatolog\xEDa",
    requiresPrescription: true,
    // CONTROLADO POR EL SERVIDOR
    icaRegistration: "Reg. ICA 9741-MV",
    activeIngredient: "Oclacitinib Maleato 16 mg",
    concentration: "16 mg",
    pharmaceuticalForm: "Comprimidos orales ranurados",
    storageCondition: "TEMPERATURA_AMBIENTE",
    temperatureColdChain: false,
    price: 189e3,
    originalPrice: 215e3,
    discountPercent: 12,
    presentation: "Bl\xEDster x 20 Comprimidos",
    weightKg: 0.05,
    unitPriceText: "$9.450/Comprimido",
    image: "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=800&auto=format&fit=crop&q=80",
    description: "Indicado para el control del prurito asociado con dermatitis al\xE9rgica y manifestaciones cl\xEDnicas de dermatitis at\xF3pica en perros de m\xE1s de 12 meses.",
    authorizedInfo: "VENTA BAJO F\xD3RMULA DEL M\xC9DICO VETERINARIO. Requiere revisi\xF3n farmac\xE9utica obligatoria antes de despacho.",
    stockByStore: { HUB_KENNEDY: 10, HUB_ALAMOS: 6, HUB_SUBA: 5, HUB_CENTRO: 2 },
    reservedStockByStore: { HUB_KENNEDY: 1, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-APQ26-88", expiryDate: "2027-03-31", quantity: 20 }],
    rating: 4.9,
    reviewsCount: 140,
    tags: ["apoquel", "dermatologia", "alergia", "formula requerida", "oclacitinib"]
  },
  {
    id: "prod-meloxicam-gotas",
    sku: "FAR-MELOX-10ML",
    barcode: "7709876543214",
    name: "Meloxicam Suspensi\xF3n Oral 0.5 mg/ml (Requiere F\xF3rmula)",
    brand: "Carval",
    species: "Perro",
    category: "Farmacia",
    pharmacySubcategory: "Medicamentos veterinarios",
    requiresPrescription: true,
    icaRegistration: "Reg. ICA 8820-MV",
    activeIngredient: "Meloxicam 0.5 mg/ml",
    concentration: "0.5 mg / ml",
    pharmaceuticalForm: "Suspensi\xF3n oral con jeringa dosificadora",
    storageCondition: "LUGAR_FRESCO_Y_SECO",
    temperatureColdChain: false,
    price: 38e3,
    originalPrice: 44e3,
    discountPercent: 13,
    presentation: "Frasco gotero 15 ml",
    weightKg: 0.08,
    unitPriceText: "$2.533/ml",
    image: "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=800&auto=format&fit=crop&q=80",
    description: "Antiinflamatorio no esteroideo (AINE) para alivio del dolor e inflamaci\xF3n en trastornos m\xFAsculo-esquel\xE9ticos agudos y cr\xF3nicos.",
    authorizedInfo: "Medicamento controlado. Venta estricta bajo prescripci\xF3n m\xE9dica veterinaria.",
    stockByStore: { HUB_KENNEDY: 14, HUB_ALAMOS: 8, HUB_SUBA: 7, HUB_CENTRO: 3 },
    reservedStockByStore: { HUB_KENNEDY: 0, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-MLX26-05", expiryDate: "2026-12-15", quantity: 25 }],
    rating: 4.7,
    reviewsCount: 78,
    tags: ["meloxicam", "antiinflamatorio", "dolor", "formula requerida"]
  },
  // FARMACIA — OTROS CUIDADOS
  {
    id: "prod-drontal-plus",
    sku: "FAR-DRONT-PLUS",
    barcode: "7709876543215",
    name: "Drontal Plus Perros Sabor Carne x 2 Tabletas",
    brand: "Elanco",
    species: "Perro",
    category: "Farmacia",
    pharmacySubcategory: "Desparasitaci\xF3n",
    requiresPrescription: false,
    icaRegistration: "Reg. ICA 6120-MV",
    activeIngredient: "Prazicuantel 50mg + Pirantel 144mg + Febantel 150mg",
    concentration: "Perros hasta 10 Kg",
    pharmaceuticalForm: "Tableta con forma de hueso",
    storageCondition: "TEMPERATURA_AMBIENTE",
    temperatureColdChain: false,
    price: 32e3,
    originalPrice: 38e3,
    discountPercent: 15,
    presentation: "Bl\xEDster x 2 Tabletas",
    weightKg: 0.04,
    unitPriceText: "$16.000/Tableta",
    image: "https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=800&auto=format&fit=crop&q=80",
    description: "Antiparasitario interno de amplio espectro contra nematodos, cestodos y Giardia spp. en perros.",
    stockByStore: { HUB_KENNEDY: 30, HUB_ALAMOS: 20, HUB_SUBA: 25, HUB_CENTRO: 10 },
    reservedStockByStore: { HUB_KENNEDY: 0, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-DRN26-77", expiryDate: "2027-10-01", quantity: 50 }],
    rating: 4.9,
    reviewsCount: 195,
    tags: ["drontal", "desparasitante", "giardia", "perros"]
  },
  {
    id: "prod-fortiflora-dog",
    sku: "FAR-FORTI-DOG",
    barcode: "7709876543216",
    name: "Purina Pro Plan FortiFlora Suplemento Probi\xF3tico",
    brand: "Pro Plan Veterinary Diets",
    species: "Perro",
    category: "Farmacia",
    pharmacySubcategory: "Cuidado digestivo",
    requiresPrescription: false,
    icaRegistration: "Reg. ICA 10314-AL",
    activeIngredient: "Enterococcus faecium SF68 microencapsulado",
    concentration: "1x10^8 UFC/g",
    pharmaceuticalForm: "Polvo palatable en sobres",
    storageCondition: "LUGAR_FRESCO_Y_SECO",
    temperatureColdChain: false,
    price: 118e3,
    originalPrice: 132e3,
    discountPercent: 10,
    presentation: "Caja x 30 Sobres de 1 g",
    weightKg: 0.15,
    unitPriceText: "$3.933/Sobre",
    image: "https://images.unsplash.com/photo-1512069772995-ec65ed45afd6?w=800&auto=format&fit=crop&q=80",
    description: "Probi\xF3tico n\xFAmero 1 recomendado por veterinarios para restablecer el equilibrio microbiano intestinal durante diarreas agudas o estr\xE9s.",
    stockByStore: { HUB_KENNEDY: 12, HUB_ALAMOS: 8, HUB_SUBA: 6, HUB_CENTRO: 4 },
    reservedStockByStore: { HUB_KENNEDY: 0, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-FTF26-31", expiryDate: "2027-04-30", quantity: 20 }],
    rating: 5,
    reviewsCount: 112,
    tags: ["fortiflora", "probiotico", "gastrointestinal", "diarrea", "purina"]
  },
  // ARENAS
  {
    id: "prod-arena-odourlock",
    sku: "ARE-ODOUR-12KG",
    barcode: "7701122334455",
    name: "Arena Sanitaria OdourLock Sin Olor Calidad Premium",
    brand: "Intersand",
    species: "Gato",
    category: "Arenas",
    requiresPrescription: false,
    storageCondition: "LUGAR_FRESCO_Y_SECO",
    temperatureColdChain: false,
    price: 89e3,
    originalPrice: 105e3,
    discountPercent: 15,
    presentation: "Bolsa 12 Kg",
    weightKg: 12,
    unitPriceText: "$7.416/Kg",
    image: "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=800&auto=format&fit=crop&q=80",
    description: "Arena aglomerante de arcilla natural canadiense. Bloquea el amon\xEDaco por 40 d\xEDas garantizados. 99.9% libre de polvo.",
    stockByStore: { HUB_KENNEDY: 16, HUB_ALAMOS: 8, HUB_SUBA: 10, HUB_CENTRO: 2 },
    reservedStockByStore: { HUB_KENNEDY: 1, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-ODL26-01", expiryDate: "2029-12-31", quantity: 30 }],
    rating: 4.9,
    reviewsCount: 260,
    isLightningDeal: true,
    tags: ["arena", "gato", "odourlock", "aglomerante", "sin polvo"]
  },
  // SNACKS
  {
    id: "prod-churu-atun-pollo",
    sku: "SNK-CHURU-4U",
    barcode: "7705544332211",
    name: "Churu Pur\xE9 Cremoso para Gatos At\xFAn con Pollo",
    brand: "Inaba Churu",
    species: "Gato",
    category: "Snacks",
    requiresPrescription: false,
    storageCondition: "LUGAR_FRESCO_Y_SECO",
    temperatureColdChain: false,
    price: 18900,
    originalPrice: 22e3,
    discountPercent: 14,
    presentation: "Pack x 4 Tubos (56 g)",
    weightKg: 0.08,
    unitPriceText: "$4.725/Tubo",
    image: "https://images.unsplash.com/photo-1533738363-b7f9aef128ce?w=800&auto=format&fit=crop&q=80",
    description: "Golosina cremosa irresistible y de alta hidrataci\xF3n para gatos elaborada con at\xFAn salvaje y pollo criado en granja.",
    stockByStore: { HUB_KENNEDY: 45, HUB_ALAMOS: 25, HUB_SUBA: 30, HUB_CENTRO: 15 },
    reservedStockByStore: { HUB_KENNEDY: 3, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-CHU26-55", expiryDate: "2027-06-25", quantity: 80 }],
    rating: 5,
    reviewsCount: 420,
    tags: ["churu", "snack", "gato", "pure", "inaba"]
  },
  // HIGIENE & ACCESORIOS
  {
    id: "prod-toallitas-bio-pet",
    sku: "HIG-TOAL-100U",
    barcode: "7709988776655",
    name: "Toallitas H\xFAmedas Hipoalerg\xE9nicas para Mascotas",
    brand: "BioPet Clean",
    species: "Ambos",
    category: "Higiene",
    requiresPrescription: false,
    storageCondition: "LUGAR_FRESCO_Y_SECO",
    temperatureColdChain: false,
    price: 24500,
    originalPrice: 29e3,
    discountPercent: 15,
    presentation: "Paquete x 100 Toallitas",
    weightKg: 0.6,
    unitPriceText: "$245/Unidad",
    image: "https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=800&auto=format&fit=crop&q=80",
    description: "Enriquecidas con aloe vera y vitamina E. Libres de alcohol y parabenos, ideales para limpieza de patas y pelaje tras paseos.",
    stockByStore: { HUB_KENNEDY: 35, HUB_ALAMOS: 18, HUB_SUBA: 20, HUB_CENTRO: 10 },
    reservedStockByStore: { HUB_KENNEDY: 0, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-BIO26-99", expiryDate: "2028-01-10", quantity: 60 }],
    rating: 4.8,
    reviewsCount: 150,
    tags: ["toallitas", "higiene", "patas", "aloe vera"]
  },
  {
    id: "prod-arnes-bolt-reflectivo",
    sku: "ACC-ARNES-BOLT-M",
    barcode: "7707766554433",
    name: "Arn\xE9s Ergon\xF3mico Antitirones Reflectivo Bolt Pets",
    brand: "Bolt Pets Original",
    species: "Perro",
    category: "Accesorios",
    requiresPrescription: false,
    storageCondition: "TEMPERATURA_AMBIENTE",
    temperatureColdChain: false,
    price: 69e3,
    originalPrice: 85e3,
    discountPercent: 18,
    presentation: "Talla M Ajustable (10 a 22 Kg)",
    weightKg: 0.35,
    unitPriceText: "$69.000/Unidad",
    image: "https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=800&auto=format&fit=crop&q=80",
    description: "Dise\xF1o antitirones acolchado y transpirable con costuras reflectivas 3M para m\xE1xima visibilidad nocturna en paseos por Bogot\xE1.",
    stockByStore: { HUB_KENNEDY: 14, HUB_ALAMOS: 8, HUB_SUBA: 12, HUB_CENTRO: 5 },
    reservedStockByStore: { HUB_KENNEDY: 0, HUB_ALAMOS: 0, HUB_SUBA: 0, HUB_CENTRO: 0 },
    lots: [{ lotNumber: "L-ARN26-BOLT", expiryDate: "2035-12-31", quantity: 25 }],
    rating: 4.9,
    reviewsCount: 89,
    isNew: true,
    tags: ["arnes", "accesorio", "bolt pets", "reflectivo", "paseo"]
  }
];
var INITIAL_DRIVERS = [
  {
    id: "DRV-CARLOS-01",
    name: "Carlos Rodr\xEDguez",
    phone: "+57 312 456 7890",
    vehiclePlate: "TPK-44E",
    vehicleType: "MOTO",
    maxWeightKg: 25,
    rating: 4.95,
    photo: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80",
    isOnline: true,
    currentStatus: "EN_CAMINO_CLIENTE",
    currentLocation: {
      lat: 4.6312,
      lng: -74.1485,
      heading: 210,
      speed: 32,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    activeOrderId: "ORD-2026-8941",
    activeAssignmentId: "ASG-5510",
    cashBalance: 68500
  },
  {
    id: "DRV-DAVID-02",
    name: "David G\xF3mez",
    phone: "+57 310 987 6543",
    vehiclePlate: "MNB-12F",
    vehicleType: "MOTO",
    maxWeightKg: 25,
    rating: 4.88,
    photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80",
    isOnline: true,
    currentStatus: "DISPONIBLE",
    currentLocation: {
      lat: 4.6295,
      lng: -74.1545,
      heading: 90,
      speed: 0,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    cashBalance: 0
  },
  {
    id: "DRV-VALENTINA-03",
    name: "Valentina R\xEDos",
    phone: "+57 320 123 4567",
    vehiclePlate: "ZXZ-89D",
    vehicleType: "MOTO",
    maxWeightKg: 25,
    rating: 4.92,
    photo: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80",
    isOnline: true,
    currentStatus: "DISPONIBLE",
    currentLocation: {
      lat: 4.6945,
      lng: -74.1205,
      heading: 0,
      speed: 0,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    cashBalance: 0
  }
];
var INITIAL_ORDERS = [
  {
    id: "ORD-2026-8941",
    orderNumber: "#BP-8941",
    createdAt: new Date(Date.now() - 12 * 60 * 1e3).toISOString(),
    storeId: "HUB_KENNEDY",
    storeName: "Sede Principal Kennedy",
    customer: {
      name: "Mar\xEDa Camila Restrepo",
      phone: "+57 315 889 0012",
      email: "m.camila@example.com",
      isGuest: false
    },
    deliveryAddress: {
      address: "Calle 3 #78-20, Apto 502, Kennedy Central",
      details: "Conjunto Residencial Los Sauces, Torre 2",
      porteriaPolicy: "DEJAR_EN_PORTERIA",
      coordinates: { lat: 4.6365, lng: -74.1448 }
    },
    items: [
      {
        productId: "prod-nexgard-spectra-m",
        sku: "FAR-NX-SPEC-715",
        name: "NexGard Spectra 7.5 a 15 Kg",
        brand: "Boehringer Ingelheim",
        presentation: "Caja x 1 Tableta Masticable",
        price: 68500,
        quantity: 1,
        image: "https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=800&auto=format&fit=crop&q=80",
        weightKg: 0.1,
        requiresPrescription: false,
        picked: true,
        verifiedLot: "L-NX26-A1"
      },
      {
        productId: "prod-churu-atun-pollo",
        sku: "SNK-CHURU-4U",
        name: "Churu Pur\xE9 Cremoso At\xFAn con Pollo",
        brand: "Inaba Churu",
        presentation: "Pack x 4 Tubos (56 g)",
        price: 18900,
        quantity: 1,
        image: "https://images.unsplash.com/photo-1533738363-b7f9aef128ce?w=800&auto=format&fit=crop&q=80",
        weightKg: 0.08,
        requiresPrescription: false,
        picked: true,
        verifiedLot: "L-CHU26-55"
      }
    ],
    totals: {
      subtotal: 87400,
      discount: 0,
      shipping: 0,
      serviceFee: 1500,
      tip: 2e3,
      total: 90900,
      totalWeightKg: 0.18
    },
    payment: {
      method: "WOMPI_CARD",
      status: "APROBADO",
      transactionId: "TXN-WMP-7788912"
    },
    prescriptionReview: {
      status: "NO_REQUIERE"
    },
    fulfillmentStatus: "EN_CAMINO",
    secretDeliveryCode: "4892",
    estimatedDeliveryMinutes: 7,
    originalPromiseWindow: {
      start: new Date(Date.now() - 10 * 60 * 1e3).toISOString(),
      end: new Date(Date.now() + 5 * 60 * 1e3).toISOString()
    },
    timestamps: {
      confirmedAt: new Date(Date.now() - 11 * 60 * 1e3).toISOString(),
      prepStartedAt: new Date(Date.now() - 9 * 60 * 1e3).toISOString(),
      prepCompletedAt: new Date(Date.now() - 6 * 60 * 1e3).toISOString(),
      assignedAt: new Date(Date.now() - 5 * 60 * 1e3).toISOString(),
      pickedUpAt: new Date(Date.now() - 3 * 60 * 1e3).toISOString()
    },
    driver: {
      id: "DRV-CARLOS-01",
      name: "Carlos Rodr\xEDguez",
      phone: "+57 312 456 7890",
      vehiclePlate: "TPK-44E",
      vehicleType: "MOTO",
      rating: 4.95,
      photo: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80"
    }
  },
  {
    id: "ORD-2026-8942",
    orderNumber: "#BP-8942",
    createdAt: new Date(Date.now() - 25 * 60 * 1e3).toISOString(),
    storeId: "HUB_KENNEDY",
    storeName: "Sede Principal Kennedy",
    customer: {
      name: "Andr\xE9s Felipe Morales",
      phone: "+57 311 234 5678",
      email: "andres.felipe@example.com",
      isGuest: false
    },
    deliveryAddress: {
      address: "Transversal 78H #38C-10 Sur, Kennedy",
      details: "Casa esquinera port\xF3n blanco",
      porteriaPolicy: "LLAMAR_AL_LLEGAR",
      coordinates: { lat: 4.6225, lng: -74.1585 }
    },
    items: [
      {
        productId: "prod-apoquel-16mg",
        sku: "FAR-APOQ-16MG",
        name: "Apoquel 16 mg Oclacitinib",
        brand: "Zoetis",
        presentation: "Bl\xEDster x 20 Comprimidos",
        price: 189e3,
        quantity: 1,
        image: "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=800&auto=format&fit=crop&q=80",
        weightKg: 0.05,
        requiresPrescription: true,
        picked: false
      }
    ],
    totals: {
      subtotal: 189e3,
      discount: 0,
      shipping: 0,
      serviceFee: 1500,
      tip: 0,
      total: 190500,
      totalWeightKg: 0.05
    },
    payment: {
      method: "WOMPI_PSE",
      status: "APROBADO",
      transactionId: "TXN-WMP-7788913"
    },
    prescriptionReview: {
      status: "PENDIENTE_REVISION",
      documentUrl: "https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=800&auto=format&fit=crop&q=80",
      documentName: "formula_medica_dr_ramirez_oct2026.pdf",
      uploadedAt: new Date(Date.now() - 23 * 60 * 1e3).toISOString(),
      vetName: "Dr. Alejandro Ram\xEDrez - MP: 14892-COMVEZCOL",
      vetLicense: "14892"
    },
    fulfillmentStatus: "EN_ALISTAMIENTO",
    secretDeliveryCode: "7219",
    estimatedDeliveryMinutes: 20,
    originalPromiseWindow: {
      start: new Date(Date.now() - 15 * 60 * 1e3).toISOString(),
      end: new Date(Date.now() + 15 * 60 * 1e3).toISOString()
    },
    timestamps: {
      confirmedAt: new Date(Date.now() - 24 * 60 * 1e3).toISOString(),
      prepStartedAt: new Date(Date.now() - 15 * 60 * 1e3).toISOString()
    }
  }
];

// src/lib/deliveryService.ts
var DELIVERY_CONFIG = {
  coverageRadiusMeters: 6e3,
  maxDeliverySeconds: 1500,
  // 25 minutos exactos
  configVersion: "2026.1",
  defaultPrepReadySeconds: 180,
  // 3 min alistamiento base
  itemPickSeconds: 15,
  // 15 seg por ítem adicional
  courierReadySeconds: 120,
  // 2 min disponibilidad de repartidor en bodega
  pickupHandoffSeconds: 60,
  // 1 min verificación de precintos y entrega a repartidor
  customerHandoffSeconds: 120,
  // 2 min entrega física en portería / puerta
  operationalBufferSeconds: 120,
  // 2 min margen de contingencia Bogotá
  averageMotoSpeedKmH: 23,
  // Velocidad media motocicleta en Bogotá con semáforos y tráfico
  urbanRoadFactor: 1.32
  // Factor de desvío vial real vs geodésico en cuadrícula bogotana
};
function calculateHaversineDistanceMeters(coord1, coord2) {
  const R = 6371e3;
  const phi1 = coord1.lat * Math.PI / 180;
  const phi2 = coord2.lat * Math.PI / 180;
  const deltaPhi = (coord2.lat - coord1.lat) * Math.PI / 180;
  const deltaLambda = (coord2.lng - coord1.lng) * Math.PI / 180;
  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}
function estimateRoadTravel(origin, destination, customRoadFactor) {
  const geodesicMeters = calculateHaversineDistanceMeters(origin, destination);
  const roadFactor = customRoadFactor || DELIVERY_CONFIG.urbanRoadFactor;
  const roadDistanceMeters = Math.round(geodesicMeters * roadFactor);
  const speedMps = DELIVERY_CONFIG.averageMotoSpeedKmH * 1e3 / 3600;
  const travelSeconds = Math.round(roadDistanceMeters / speedMps);
  return { roadDistanceMeters, travelSeconds };
}
function computeTotalETASeconds(roadTravelSeconds, itemCount = 1) {
  const preparationReadySeconds = DELIVERY_CONFIG.defaultPrepReadySeconds + Math.max(0, itemCount - 1) * DELIVERY_CONFIG.itemPickSeconds;
  const courierReadyAtWarehouseSeconds = DELIVERY_CONFIG.courierReadySeconds;
  const pickupHandoffSeconds = DELIVERY_CONFIG.pickupHandoffSeconds;
  const customerHandoffSeconds = DELIVERY_CONFIG.customerHandoffSeconds;
  const operationalBufferSeconds = DELIVERY_CONFIG.operationalBufferSeconds;
  const dispatchPrepOverlap = Math.max(preparationReadySeconds, courierReadyAtWarehouseSeconds);
  const totalSeconds = dispatchPrepOverlap + pickupHandoffSeconds + roadTravelSeconds + customerHandoffSeconds + operationalBufferSeconds;
  const estimatedMinutes = Math.ceil(totalSeconds / 60);
  const etaComponents = {
    preparationReadySeconds,
    courierReadyAtWarehouseSeconds,
    pickupHandoffSeconds,
    roadTravelSeconds,
    customerHandoffSeconds,
    operationalBufferSeconds,
    totalSeconds
  };
  return { etaComponents, totalSeconds, estimatedMinutes };
}
function evaluateDeliveryQuote(req, stores2, catalogProducts) {
  const { destination, items } = req;
  const now = /* @__PURE__ */ new Date();
  const quoteId = `QUO-${Date.now()}-${Math.floor(Math.random() * 9e3 + 1e3)}`;
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1e3).toISOString();
  if (!destination || !destination.coordinates || isNaN(destination.coordinates.lat) || isNaN(destination.coordinates.lng)) {
    return {
      quoteId,
      eligibilityStatus: "ADDRESS_NEEDS_CONFIRMATION",
      reasonCode: "MISSING_COORDINATES",
      message: "Por favor confirma el punto exacto de entrega en el mapa.",
      destination: destination || { address: "", coordinates: { lat: 0, lng: 0 } },
      geographicDistanceMeters: 0,
      geographicDistanceKm: 0,
      roadDistanceMeters: 0,
      roadDistanceKm: 0,
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: 0,
      basketValidated: false
    };
  }
  const activeTurboStores = stores2.filter((s) => s.isActive && s.turboEnabled);
  if (activeTurboStores.length === 0) {
    return {
      quoteId,
      eligibilityStatus: "NO_AVAILABLE_WAREHOUSE",
      reasonCode: "NO_ACTIVE_TURBO_STORES",
      message: "No hay sedes habilitadas disponibles para entregas Turbo en este momento.",
      destination,
      geographicDistanceMeters: 0,
      geographicDistanceKm: 0,
      roadDistanceMeters: 0,
      roadDistanceKm: 0,
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: 0,
      basketValidated: false
    };
  }
  const candidates = [];
  const itemCount = items ? items.reduce((acc, i) => acc + i.quantity, 0) : 1;
  for (const store of activeTurboStores) {
    const geoDistanceMeters = calculateHaversineDistanceMeters(store.coordinates, destination.coordinates);
    if (geoDistanceMeters <= DELIVERY_CONFIG.coverageRadiusMeters) {
      let stockSufficient = true;
      if (items && items.length > 0 && catalogProducts) {
        for (const basketItem of items) {
          const prod = catalogProducts.find((p) => p.id === basketItem.productId);
          if (prod) {
            const currentStock = prod.stockByStore[store.id] || 0;
            const currentReserved = prod.reservedStockByStore[store.id] || 0;
            const availableToSell = currentStock - currentReserved;
            if (availableToSell - basketItem.quantity < 0) {
              stockSufficient = false;
              break;
            }
          }
        }
      }
      const { roadDistanceMeters, travelSeconds } = estimateRoadTravel(store.coordinates, destination.coordinates);
      const { etaComponents, totalSeconds, estimatedMinutes } = computeTotalETASeconds(travelSeconds, itemCount);
      candidates.push({
        store,
        geoDistanceMeters,
        roadDistanceMeters,
        roadTravelSeconds: travelSeconds,
        totalSeconds,
        estimatedMinutes,
        etaComponents,
        stockSufficient
      });
    }
  }
  if (candidates.length === 0) {
    let minGeoDistance = Infinity;
    for (const store of activeTurboStores) {
      const d = calculateHaversineDistanceMeters(store.coordinates, destination.coordinates);
      if (d < minGeoDistance) minGeoDistance = d;
    }
    return {
      quoteId,
      eligibilityStatus: "OUT_OF_COVERAGE",
      reasonCode: "DISTANCE_EXCEEDS_6KM",
      message: "Esta direcci\xF3n est\xE1 fuera de nuestra cobertura de 6 km.",
      destination,
      geographicDistanceMeters: minGeoDistance,
      geographicDistanceKm: Number((minGeoDistance / 1e3).toFixed(1)),
      roadDistanceMeters: Math.round(minGeoDistance * DELIVERY_CONFIG.urbanRoadFactor),
      roadDistanceKm: Number((minGeoDistance * DELIVERY_CONFIG.urbanRoadFactor / 1e3).toFixed(1)),
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: activeTurboStores.length,
      basketValidated: !!items?.length
    };
  }
  const stockEligibleCandidates = candidates.filter((c) => c.stockSufficient);
  if (items && items.length > 0 && stockEligibleCandidates.length === 0) {
    return {
      quoteId,
      eligibilityStatus: "INSUFFICIENT_STOCK",
      reasonCode: "OUT_OF_STOCK_IN_COVERED_HUBS",
      message: "Las sedes dentro de tu cobertura no cuentan con existencias suficientes para todos los productos de tu carrito.",
      destination,
      geographicDistanceMeters: candidates[0].geoDistanceMeters,
      geographicDistanceKm: Number((candidates[0].geoDistanceMeters / 1e3).toFixed(1)),
      roadDistanceMeters: candidates[0].roadDistanceMeters,
      roadDistanceKm: Number((candidates[0].roadDistanceMeters / 1e3).toFixed(1)),
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: candidates.length,
      basketValidated: true
    };
  }
  const pool = stockEligibleCandidates.length > 0 ? stockEligibleCandidates : candidates;
  const timeEligibleCandidates = pool.filter((c) => c.totalSeconds <= DELIVERY_CONFIG.maxDeliverySeconds);
  if (timeEligibleCandidates.length === 0) {
    const bestCandidate = pool.sort((a, b) => a.totalSeconds - b.totalSeconds)[0];
    return {
      quoteId,
      eligibilityStatus: "OVER_TIME_LIMIT",
      reasonCode: "ETA_EXCEEDS_1500_SECONDS",
      message: "Por el momento no podemos entregar en esta direcci\xF3n dentro de 25 minutos.",
      destination,
      geographicDistanceMeters: bestCandidate.geoDistanceMeters,
      geographicDistanceKm: Number((bestCandidate.geoDistanceMeters / 1e3).toFixed(1)),
      roadDistanceMeters: bestCandidate.roadDistanceMeters,
      roadDistanceKm: Number((bestCandidate.roadDistanceMeters / 1e3).toFixed(1)),
      etaComponents: bestCandidate.etaComponents,
      estimatedMinutes: bestCandidate.estimatedMinutes,
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: pool.length,
      basketValidated: !!items?.length
    };
  }
  timeEligibleCandidates.sort((a, b) => {
    if (a.totalSeconds !== b.totalSeconds) {
      return a.totalSeconds - b.totalSeconds;
    }
    return a.roadDistanceMeters - b.roadDistanceMeters;
  });
  const winner = timeEligibleCandidates[0];
  return {
    quoteId,
    eligibilityStatus: "ELIGIBLE",
    reasonCode: "SUCCESS",
    message: `Entregamos en esta direcci\xF3n en aprox. ${winner.estimatedMinutes} min desde ${winner.store.name}.`,
    assignedStoreId: winner.store.id,
    assignedStoreName: winner.store.name,
    assignedStoreAddress: winner.store.address,
    assignedStoreCoordinates: winner.store.coordinates,
    destination,
    geographicDistanceMeters: winner.geoDistanceMeters,
    geographicDistanceKm: Number((winner.geoDistanceMeters / 1e3).toFixed(1)),
    roadDistanceMeters: winner.roadDistanceMeters,
    roadDistanceKm: Number((winner.roadDistanceMeters / 1e3).toFixed(1)),
    etaComponents: winner.etaComponents,
    estimatedMinutes: winner.estimatedMinutes,
    calculatedAt: now.toISOString(),
    expiresAt,
    configVersion: DELIVERY_CONFIG.configVersion,
    candidateWarehousesEvaluated: pool.length,
    basketValidated: !!items?.length
  };
}

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var stores = JSON.parse(JSON.stringify(INITIAL_STORES));
var products = JSON.parse(JSON.stringify(INITIAL_PRODUCTS));
var drivers = JSON.parse(JSON.stringify(INITIAL_DRIVERS));
var orders = JSON.parse(JSON.stringify(INITIAL_ORDERS));
var gpsTelemetryHistory = {
  "ORD-2026-8941": [
    {
      orderId: "ORD-2026-8941",
      assignmentId: "ASG-5510",
      tripId: "TRP-8821",
      latitude: 4.6312,
      longitude: -74.1485,
      accuracy: 4.5,
      heading: 210,
      speed: 32,
      batteryLevel: 85,
      timestamp: Date.now() - 4e3,
      sequenceNumber: 142
    }
  ]
};
async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);
  app.use(cors());
  app.use(express.json({ limit: "15mb" }));
  app.get("/api/v1/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "Bolt Pets Authoritative Backend",
      version: "1.0.0",
      timezone: "America/Bogota",
      locale: "es-CO",
      storesCount: stores.length,
      productsCount: products.length,
      ordersCount: orders.length,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.get("/api/v1/stores", (_req, res) => {
    res.json(stores);
  });
  app.get("/api/v1/catalog", (req, res) => {
    const { category, species, storeId, q } = req.query;
    let filtered = [...products];
    if (category && category !== "Todo") {
      filtered = filtered.filter((p) => p.category === category || p.pharmacySubcategory === category);
    }
    if (species && species !== "Todos") {
      filtered = filtered.filter((p) => p.species === species || p.species === "Ambos");
    }
    if (q) {
      const queryStr = String(q).toLowerCase();
      filtered = filtered.filter(
        (p) => p.name.toLowerCase().includes(queryStr) || p.brand.toLowerCase().includes(queryStr) || p.sku.toLowerCase().includes(queryStr) || p.activeIngredient && p.activeIngredient.toLowerCase().includes(queryStr) || p.tags.some((t) => t.toLowerCase().includes(queryStr))
      );
    }
    res.json(filtered);
  });
  app.post("/api/v1/delivery/quote", (req, res) => {
    try {
      const quote = evaluateDeliveryQuote(req.body, stores, products);
      return res.json(quote);
    } catch (e) {
      console.error("Error in /api/v1/delivery/quote:", e);
      return res.status(500).json({ error: e.message || "Error al calcular cotizaci\xF3n de entrega" });
    }
  });
  app.post("/api/v1/orders", (req, res) => {
    try {
      const { storeId, items, customer, deliveryAddress, paymentMethod, tip = 0 } = req.body;
      if (!items || !items.length || !customer || !deliveryAddress || !paymentMethod) {
        return res.status(400).json({ error: "Faltan campos obligatorios para crear el pedido." });
      }
      let assignedStoreId = storeId;
      let evaluatedQuote = null;
      if (deliveryAddress.coordinates && !isNaN(deliveryAddress.coordinates.lat) && !isNaN(deliveryAddress.coordinates.lng)) {
        evaluatedQuote = evaluateDeliveryQuote({
          destination: {
            address: deliveryAddress.address,
            details: deliveryAddress.details,
            coordinates: deliveryAddress.coordinates
          },
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity }))
        }, stores, products);
        if (evaluatedQuote.eligibilityStatus !== "ELIGIBLE") {
          return res.status(400).json({
            error: evaluatedQuote.message,
            eligibilityStatus: evaluatedQuote.eligibilityStatus,
            geographicDistanceMeters: evaluatedQuote.geographicDistanceMeters,
            roadDistanceMeters: evaluatedQuote.roadDistanceMeters
          });
        }
        assignedStoreId = evaluatedQuote.assignedStoreId || storeId || "HUB_KENNEDY";
      }
      const assignedStore = stores.find((s) => s.id === assignedStoreId) || stores[0];
      assignedStoreId = assignedStore.id;
      for (const item of items) {
        const prod = products.find((p) => p.id === item.productId);
        if (!prod) {
          return res.status(400).json({ error: `Producto no encontrado: ${item.productId}` });
        }
        const currentStock = prod.stockByStore[assignedStoreId] || 0;
        const currentReserved = prod.reservedStockByStore[assignedStoreId] || 0;
        const availableToSell = currentStock - currentReserved;
        if (availableToSell - item.quantity < 0) {
          return res.status(400).json({
            error: `Inventario insuficiente para ${prod.name} en ${assignedStore.name}. Disponibles para venta: ${Math.max(0, availableToSell)}`
          });
        }
      }
      for (const item of items) {
        const prod = products.find((p) => p.id === item.productId);
        prod.reservedStockByStore[assignedStoreId] = (prod.reservedStockByStore[assignedStoreId] || 0) + item.quantity;
      }
      const hasPrescriptionItem = items.some((i) => i.requiresPrescription);
      const subtotal = items.reduce((acc, curr) => acc + curr.price * curr.quantity, 0);
      const totalWeightKg = items.reduce((acc, curr) => acc + (curr.weightKg || 0.2) * curr.quantity, 0);
      const shipping = subtotal >= 7e4 ? 0 : 4900;
      const serviceFee = 1500;
      const total = subtotal + shipping + serviceFee + tip;
      const random4DigitCode = Math.floor(1e3 + Math.random() * 9e3).toString();
      const newOrderNum = `#BP-${Math.floor(1e3 + Math.random() * 9e3)}`;
      const estimatedMinutes = evaluatedQuote?.estimatedMinutes || 25;
      const promiseEnd = new Date(Date.now() + estimatedMinutes * 60 * 1e3).toISOString();
      const newOrder = {
        id: `ORD-2026-${Math.floor(1e3 + Math.random() * 9e3)}`,
        orderNumber: newOrderNum,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        storeId: assignedStoreId,
        storeName: assignedStore.name,
        customer,
        deliveryAddress,
        items,
        totals: {
          subtotal,
          discount: 0,
          shipping,
          serviceFee,
          tip,
          total,
          totalWeightKg
        },
        payment: {
          method: paymentMethod,
          status: paymentMethod === "CASH_ON_DELIVERY" ? "PENDIENTE" : "APROBADO",
          cashToCollect: paymentMethod === "CASH_ON_DELIVERY" ? total : 0,
          cashSettled: false,
          transactionId: paymentMethod !== "CASH_ON_DELIVERY" ? `TXN-WMP-${Date.now().toString().slice(-7)}` : void 0
        },
        prescriptionReview: {
          status: hasPrescriptionItem ? "PENDIENTE_REVISION" : "NO_REQUIERE"
        },
        fulfillmentStatus: "CONFIRMADO",
        secretDeliveryCode: random4DigitCode,
        estimatedDeliveryMinutes: estimatedMinutes,
        originalPromiseWindow: {
          start: (/* @__PURE__ */ new Date()).toISOString(),
          end: promiseEnd
        },
        deliveryQuoteSnapshot: evaluatedQuote ? {
          quoteId: evaluatedQuote.quoteId,
          geographicDistanceMeters: evaluatedQuote.geographicDistanceMeters,
          roadDistanceMeters: evaluatedQuote.roadDistanceMeters,
          totalSeconds: evaluatedQuote.etaComponents?.totalSeconds || estimatedMinutes * 60,
          estimatedMinutes,
          configVersion: evaluatedQuote.configVersion || DELIVERY_CONFIG.configVersion,
          assignedStoreId
        } : void 0,
        timestamps: {
          confirmedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      };
      orders.unshift(newOrder);
      return res.status(201).json(newOrder);
    } catch (e) {
      console.error("Error creating order:", e);
      return res.status(500).json({ error: e.message || "Error interno del servidor" });
    }
  });
  app.get("/api/v1/orders", (req, res) => {
    const { storeId, status } = req.query;
    let list = [...orders];
    if (storeId) list = list.filter((o) => o.storeId === storeId);
    if (status) list = list.filter((o) => o.fulfillmentStatus === status);
    res.json(list);
  });
  app.get("/api/v1/orders/:orderId", (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
    res.json(order);
  });
  app.post("/api/v1/orders/:orderId/prescription", (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
    const { documentUrl, documentName, vetName, vetLicense } = req.body;
    order.prescriptionReview = {
      status: "PENDIENTE_REVISION",
      documentUrl,
      documentName,
      uploadedAt: (/* @__PURE__ */ new Date()).toISOString(),
      vetName,
      vetLicense
    };
    res.json({ message: "F\xF3rmula veterinaria enviada a revisi\xF3n", order });
  });
  app.get("/api/v1/orders/:orderId/tracking", (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
    const history = gpsTelemetryHistory[order.id] || [];
    const latestTelemetry = history[history.length - 1];
    res.json({
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.fulfillmentStatus,
      estimatedMinutes: order.estimatedDeliveryMinutes,
      secretDeliveryCode: order.secretDeliveryCode,
      driver: order.driver ? {
        id: order.driver.id,
        name: order.driver.name,
        phone: order.driver.phone,
        vehiclePlate: order.driver.vehiclePlate,
        vehicleType: order.driver.vehicleType,
        photo: order.driver.photo,
        rating: order.driver.rating
      } : null,
      telemetry: latestTelemetry ? {
        latitude: latestTelemetry.latitude,
        longitude: latestTelemetry.longitude,
        heading: latestTelemetry.heading,
        speed: latestTelemetry.speed,
        timestamp: latestTelemetry.timestamp,
        secondsAgo: Math.floor((Date.now() - latestTelemetry.timestamp) / 1e3)
      } : null,
      hubCoordinates: stores.find((s) => s.id === order.storeId)?.coordinates || { lat: 4.6284, lng: -74.1539 },
      customerCoordinates: order.deliveryAddress.coordinates
    });
  });
  app.post("/api/v1/orders/:orderId/verify-delivery", (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
    const { deliveryCode } = req.body;
    if (order.secretDeliveryCode !== String(deliveryCode).trim()) {
      return res.status(403).json({ error: "C\xF3digo de entrega inv\xE1lido. Verifique el n\xFAmero de 4 d\xEDgitos con el cliente." });
    }
    order.fulfillmentStatus = "ENTREGADO";
    order.timestamps.deliveredAt = (/* @__PURE__ */ new Date()).toISOString();
    for (const item of order.items) {
      const prod = products.find((p) => p.id === item.productId);
      if (prod) {
        prod.stockByStore[order.storeId] = Math.max(0, (prod.stockByStore[order.storeId] || 0) - item.quantity);
        prod.reservedStockByStore[order.storeId] = Math.max(0, (prod.reservedStockByStore[order.storeId] || 0) - item.quantity);
      }
    }
    res.json({ message: "Entrega verificada exitosamente", order });
  });
  app.get("/api/v1/driver/profile", (_req, res) => {
    res.json(drivers[0]);
  });
  app.post("/api/v1/driver/shift", (req, res) => {
    const { action } = req.body;
    const driver = drivers[0];
    driver.isOnline = action === "START";
    driver.currentStatus = driver.isOnline ? "DISPONIBLE" : "FUERA_DE_TURNO";
    res.json({ message: `Turno ${driver.isOnline ? "iniciado" : "finalizado"}`, driver });
  });
  app.get("/api/v1/driver/assignments", (_req, res) => {
    const activeOrder = orders.find((o) => o.driver?.id === drivers[0].id && o.fulfillmentStatus !== "ENTREGADO");
    res.json({ activeAssignment: activeOrder || null });
  });
  app.post("/api/v1/driver/gps", (req, res) => {
    const telemetry = req.body;
    if (!telemetry.orderId || !telemetry.latitude || !telemetry.longitude) {
      return res.status(400).json({ error: "Datos de telemetr\xEDa incompletos" });
    }
    if (!gpsTelemetryHistory[telemetry.orderId]) {
      gpsTelemetryHistory[telemetry.orderId] = [];
    }
    gpsTelemetryHistory[telemetry.orderId].push(telemetry);
    if (gpsTelemetryHistory[telemetry.orderId].length > 100) {
      gpsTelemetryHistory[telemetry.orderId].shift();
    }
    const driver = drivers.find((d) => d.id === drivers[0].id);
    if (driver) {
      driver.currentLocation = {
        lat: telemetry.latitude,
        lng: telemetry.longitude,
        heading: telemetry.heading,
        speed: telemetry.speed,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    res.json({ status: "telemetry_received", count: gpsTelemetryHistory[telemetry.orderId].length });
  });
  app.post("/api/v1/operations/orders/:orderId/status", (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
    const { status } = req.body;
    order.fulfillmentStatus = status;
    if (status === "EN_ALISTAMIENTO" && !order.timestamps.prepStartedAt) {
      order.timestamps.prepStartedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    if (status === "LISTO_PARA_DESPACHO" && !order.timestamps.prepCompletedAt) {
      order.timestamps.prepCompletedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    if (status === "EN_CAMINO" && !order.timestamps.pickedUpAt) {
      order.timestamps.pickedUpAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    res.json({ message: "Estado actualizado", order });
  });
  app.post("/api/v1/operations/orders/:orderId/prescription/review", (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
    const { status, reviewNotes, reviewerName } = req.body;
    order.prescriptionReview = {
      ...order.prescriptionReview,
      status,
      reviewNotes,
      reviewedBy: reviewerName || "Dra. Sandra Pe\xF1a (Qu\xEDmica Farmac\xE9utica Veterinaria)",
      reviewedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    res.json({ message: "Revisi\xF3n farmac\xE9utica registrada", order });
  });
  app.post("/api/v1/operations/orders/:orderId/assign-driver", (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });
    const { driverId } = req.body;
    const driver = drivers.find((d) => d.id === driverId) || drivers[0];
    order.driver = {
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      vehiclePlate: driver.vehiclePlate,
      vehicleType: driver.vehicleType,
      rating: driver.rating,
      photo: driver.photo
    };
    order.fulfillmentStatus = "REPARTIDOR_ASIGNADO";
    order.timestamps.assignedAt = (/* @__PURE__ */ new Date()).toISOString();
    res.json({ message: "Conductor asignado exitosamente", order });
  });
  app.get("/api/v1/integrations/status", (_req, res) => {
    res.json({
      shopifyOlfato: {
        name: "Shopify / Olfato",
        status: "En pruebas",
        lastSync: new Date(Date.now() - 45 * 60 * 1e3).toISOString(),
        mappedSkusCount: 42
      },
      siigoNube: {
        name: "Siigo Nube (Facturaci\xF3n Electr\xF3nica DIAN)",
        status: "En pruebas",
        lastSync: new Date(Date.now() - 15 * 60 * 1e3).toISOString(),
        pendingInvoices: 2
      },
      wompi: {
        name: "Wompi Colombia (Bancolombia, Tarjetas, PSE)",
        status: "Conectada (Ambiente Sandbox)",
        lastTransaction: new Date(Date.now() - 12 * 60 * 1e3).toISOString()
      },
      whatsappBot: {
        name: "WhatsApp Business API Bot",
        status: "Conectada (Simulador Activo)",
        activeConversations: 3
      }
    });
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Bolt Pets Authoritative Full-Stack Server running on port ${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * BOLT PETS — DELIVERY & COVERAGE SERVICE
 * 
 * Reglas autoritativas:
 * - Radio máximo de cobertura geográfica: 6.000 metros (6 km) por bodega habilitada.
 * - Límite máximo de entrega total aceptada: 25 minutos (1.500 segundos).
 * - Asignación automática de bodega basada en menor tiempo total de entrega y ruta vial real.
 */
