// server.ts
import"dotenv/config";
import express from "express";
import cors from "cors";
import path2 from "path";
import { timingSafeEqual as timingSafeEqual2 } from "node:crypto";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

// src/data/seedData.ts
var INITIAL_DRIVERS = [
  {
    id: "DRV-CARLOS-01",
    name: "Carlos Rodríguez",
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
      updatedAt: new Date().toISOString()
    },
    activeOrderId: "ORD-2026-8941",
    activeAssignmentId: "ASG-5510",
    cashBalance: 68500
  },
  {
    id: "DRV-DAVID-02",
    name: "David Gómez",
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
      updatedAt: new Date().toISOString()
    },
    cashBalance: 0
  },
  {
    id: "DRV-VALENTINA-03",
    name: "Valentina Ríos",
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
      updatedAt: new Date().toISOString()
    },
    cashBalance: 0
  }
];
var INITIAL_ORDERS = [
  {
    id: "ORD-2026-8941",
    orderNumber: "#BP-8941",
    createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    storeId: "HUB_KENNEDY",
    storeName: "Sede Principal Kennedy",
    customer: {
      name: "María Camila Restrepo",
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
        name: "Churu Puré Cremoso Atún con Pollo",
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
      tip: 2000,
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
      start: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      end: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    },
    timestamps: {
      confirmedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      prepStartedAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
      prepCompletedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      assignedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      pickedUpAt: new Date(Date.now() - 3 * 60 * 1000).toISOString()
    },
    driver: {
      id: "DRV-CARLOS-01",
      name: "Carlos Rodríguez",
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
    createdAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    storeId: "HUB_KENNEDY",
    storeName: "Sede Principal Kennedy",
    customer: {
      name: "Andrés Felipe Morales",
      phone: "+57 311 234 5678",
      email: "andres.felipe@example.com",
      isGuest: false
    },
    deliveryAddress: {
      address: "Transversal 78H #38C-10 Sur, Kennedy",
      details: "Casa esquinera portón blanco",
      porteriaPolicy: "LLAMAR_AL_LLEGAR",
      coordinates: { lat: 4.6225, lng: -74.1585 }
    },
    items: [
      {
        productId: "prod-apoquel-16mg",
        sku: "FAR-APOQ-16MG",
        name: "Apoquel 16 mg Oclacitinib",
        brand: "Zoetis",
        presentation: "Blíster x 20 Comprimidos",
        price: 189000,
        quantity: 1,
        image: "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=800&auto=format&fit=crop&q=80",
        weightKg: 0.05,
        requiresPrescription: true,
        picked: false
      }
    ],
    totals: {
      subtotal: 189000,
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
      uploadedAt: new Date(Date.now() - 23 * 60 * 1000).toISOString(),
      vetName: "Dr. Alejandro Ramírez - MP: 14892-COMVEZCOL",
      vetLicense: "14892"
    },
    fulfillmentStatus: "EN_ALISTAMIENTO",
    secretDeliveryCode: "7219",
    estimatedDeliveryMinutes: 20,
    originalPromiseWindow: {
      start: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      end: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    },
    timestamps: {
      confirmedAt: new Date(Date.now() - 24 * 60 * 1000).toISOString(),
      prepStartedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString()
    }
  },
  {
    id: "ORD-2026-9050",
    orderNumber: "#BP-9050",
    createdAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    storeId: "HUB_KENNEDY",
    storeName: "Sede Principal Kennedy",
    deliveryMode: "TURBO_DIVIDIDO",
    isSplitOrder: true,
    shipmentCount: 2,
    customer: {
      name: "Natalia Cárdenas (Criadero Canino)",
      phone: "+57 310 998 7766",
      email: "natalia.cardenas@criadero.co",
      isGuest: false
    },
    deliveryAddress: {
      address: "Calle 3 #78-20, Kennedy Central, Bogotá",
      details: "Casa 4, Manzana B",
      porteriaPolicy: "SUBIR_A_PUERTA",
      coordinates: { lat: 4.6365, lng: -74.1448 }
    },
    items: [
      {
        productId: "prod-rc-maxi-15k",
        sku: "RC-MAXI-15KG",
        name: "Royal Canin Maxi Adult Perros Grandes",
        brand: "Royal Canin",
        presentation: "Bulto x 15 Kg",
        price: 365000,
        quantity: 5,
        image: "https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=800&auto=format&fit=crop&q=80",
        weightKg: 15,
        requiresPrescription: false,
        picked: true
      }
    ],
    totals: {
      subtotal: 1825000,
      discount: 0,
      shipping: 0,
      serviceFee: 1500,
      tip: 5000,
      total: 1831500,
      totalWeightKg: 75
    },
    payment: {
      method: "CASH_ON_DELIVERY",
      status: "PENDIENTE",
      cashToCollect: 1831500,
      cashSettled: false
    },
    prescriptionReview: {
      status: "NO_REQUIERE"
    },
    fulfillmentStatus: "EN_CAMINO",
    secretDeliveryCode: "4821",
    estimatedDeliveryMinutes: 20,
    originalPromiseWindow: {
      start: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
      end: new Date(Date.now() + 7 * 60 * 1000).toISOString()
    },
    timestamps: {
      confirmedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
      prepStartedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
      prepCompletedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      assignedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      pickedUpAt: new Date(Date.now() - 6 * 60 * 1000).toISOString()
    },
    driver: {
      id: "DRV-CARLOS-01",
      name: "Carlos Rodríguez",
      phone: "+57 300 456 7890",
      vehiclePlate: "XYZ-12C",
      vehicleType: "MOTO",
      rating: 4.88,
      photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80"
    },
    childShipments: [
      {
        shipmentId: "SHP-9050-1",
        shipmentIndex: 1,
        shipmentCount: 2,
        parentOrderId: "ORD-2026-9050",
        childOrderId: "ORD-2026-9050-A",
        items: [
          {
            productId: "prod-rc-maxi-15k",
            sku: "RC-MAXI-15KG",
            name: "Royal Canin Maxi Adult Perros Grandes",
            brand: "Royal Canin",
            presentation: "Bulto x 15 Kg",
            price: 365000,
            quantity: 2,
            image: "https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=800&auto=format&fit=crop&q=80",
            weightKg: 15,
            requiresPrescription: false
          }
        ],
        weightKg: 30,
        weightGrams: 30000,
        subtotal: 730000,
        cashToCollect: 732600,
        fulfillmentStatus: "ENTREGADO",
        secretDeliveryCode: "4821",
        estimatedDeliveryMinutes: 15,
        driver: {
          id: "DRV-CARLOS-01",
          name: "Carlos Rodríguez",
          phone: "+57 300 456 7890",
          vehiclePlate: "XYZ-12C",
          vehicleType: "MOTO",
          rating: 4.88,
          photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80"
        },
        timestamps: {
          confirmedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
          prepStartedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
          prepCompletedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          assignedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
          pickedUpAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
          deliveredAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
        }
      },
      {
        shipmentId: "SHP-9050-2",
        shipmentIndex: 2,
        shipmentCount: 2,
        parentOrderId: "ORD-2026-9050",
        childOrderId: "ORD-2026-9050-B",
        items: [
          {
            productId: "prod-rc-maxi-15k",
            sku: "RC-MAXI-15KG",
            name: "Royal Canin Maxi Adult Perros Grandes",
            brand: "Royal Canin",
            presentation: "Bulto x 15 Kg",
            price: 365000,
            quantity: 3,
            image: "https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=800&auto=format&fit=crop&q=80",
            weightKg: 15,
            requiresPrescription: false
          }
        ],
        weightKg: 45,
        weightGrams: 45000,
        subtotal: 1095000,
        cashToCollect: 1098900,
        fulfillmentStatus: "EN_CAMINO",
        secretDeliveryCode: "8914",
        estimatedDeliveryMinutes: 20,
        driver: {
          id: "DRV-VALENTINA-03",
          name: "Valentina Ríos",
          phone: "+57 320 123 4567",
          vehiclePlate: "ZXZ-89D",
          vehicleType: "MOTO",
          rating: 4.92,
          photo: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80"
        },
        timestamps: {
          confirmedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
          prepStartedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
          prepCompletedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          assignedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
          pickedUpAt: new Date(Date.now() - 4 * 60 * 1000).toISOString()
        }
      }
    ]
  },
  {
    id: "ORD-2026-9051",
    orderNumber: "#BP-9051",
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    storeId: "HUB_ALAMOS",
    storeName: "Sede Álamos / Engativá",
    deliveryMode: "PROGRAMADO",
    scheduledWindow: {
      slotId: "SLOT-TODAY-HORARIO_2",
      windowId: "HORARIO_2",
      windowName: "Horario 2",
      date: new Date().toISOString().split("T")[0],
      dateLabel: "Hoy",
      startTime: "14:00",
      endTime: "18:00",
      displayWindow: "14:00–18:00",
      displayWindowShort: "2:00–6:00 p. m.",
      bookingCutoffTime: "12:00",
      bookingCutoffLabel: "12:00 m.",
      commercialHook: "Pide antes de las 12:00 m. y recibe hoy de 2:00 p. m. a 6:00 p. m."
    },
    customer: {
      name: "Diana Patricia Salazar",
      phone: "+57 318 765 4321",
      email: "diana.salazar@example.com",
      isGuest: false
    },
    deliveryAddress: {
      address: "Carrera 7 #120-15, Usaquén, Bogotá",
      details: "Torre 4, Apto 802",
      porteriaPolicy: "DEJAR_EN_PORTERIA",
      coordinates: { lat: 4.698, lng: -74.032 }
    },
    items: [
      {
        productId: "prod-bravecto-20-40",
        sku: "FAR-BRAV-2040",
        name: "Bravecto 20 a 40 Kg",
        brand: "MSD Salud Animal",
        presentation: "Caja x 1 Tableta Masticable",
        price: 139000,
        quantity: 1,
        image: "https://images.unsplash.com/photo-1608248597359-5484852c0199?w=800&auto=format&fit=crop&q=80",
        weightKg: 0.1,
        requiresPrescription: false,
        picked: true
      },
      {
        productId: "prod-churu-atun-pollo",
        sku: "CAT-CHURU-ATUN",
        name: "Inaba Churu Puré Atún con Pollo para Gatos",
        brand: "Inaba Churu",
        presentation: "Paquete x 4 tubos (56g)",
        price: 19500,
        quantity: 2,
        image: "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=800&auto=format&fit=crop&q=80",
        weightKg: 0.06,
        requiresPrescription: false,
        picked: true
      }
    ],
    totals: {
      subtotal: 178000,
      discount: 0,
      shipping: 0,
      serviceFee: 1500,
      tip: 3000,
      total: 182500,
      totalWeightKg: 0.22
    },
    payment: {
      method: "WOMPI_CARD",
      status: "APROBADO",
      transactionId: "TXN-WMP-994411"
    },
    prescriptionReview: {
      status: "NO_REQUIERE"
    },
    fulfillmentStatus: "CONFIRMADO",
    secretDeliveryCode: "5920",
    estimatedDeliveryMinutes: 180,
    originalPromiseWindow: {
      start: "14:00",
      end: "18:00"
    },
    timestamps: {
      confirmedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    }
  },
  {
    id: "ORD-2026-9052",
    orderNumber: "#BP-9052",
    createdAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
    storeId: "HUB_SUBA",
    storeName: "Bolt Pets Suba",
    deliveryMode: "TURBO",
    customer: {
      name: "Santiago Méndez",
      phone: "+57 312 998 1122",
      email: "santiago.mendez@example.com",
      isGuest: false
    },
    deliveryAddress: {
      address: "Carrera 111 #145-20, Suba Tibabuyes, Bogotá",
      details: "Conjunto Rincón de Suba, Torre 1",
      porteriaPolicy: "DEJAR_EN_PORTERIA",
      coordinates: { lat: 4.748, lng: -74.101 }
    },
    items: [
      {
        productId: "prod-proplan-cat-salmon",
        sku: "PP-CAT-SALM-3KG",
        name: "Purina Pro Plan Adult Cat Salmón & Arroz",
        brand: "Pro Plan",
        presentation: "Bolsa 3 Kg",
        price: 124000,
        quantity: 1,
        image: "https://images.unsplash.com/photo-1548767797-d8c844163c4c?w=800&auto=format&fit=crop&q=80",
        weightKg: 3,
        requiresPrescription: false,
        picked: false
      }
    ],
    totals: {
      subtotal: 124000,
      discount: 0,
      shipping: 0,
      serviceFee: 1500,
      tip: 2000,
      total: 127500,
      totalWeightKg: 3
    },
    payment: {
      method: "WOMPI_PSE",
      status: "APROBADO",
      transactionId: "TXN-WMP-883311"
    },
    prescriptionReview: {
      status: "NO_REQUIERE"
    },
    fulfillmentStatus: "EN_ALISTAMIENTO",
    secretDeliveryCode: "6145",
    estimatedDeliveryMinutes: 22,
    originalPromiseWindow: {
      start: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      end: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    },
    timestamps: {
      confirmedAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
      prepStartedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString()
    }
  },
  {
    id: "ORD-2026-9053",
    orderNumber: "#BP-9053",
    createdAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
    storeId: "HUB_CENTRO",
    storeName: "Sede Centro Histórico",
    deliveryMode: "TURBO",
    customer: {
      name: "Oficinas Administrativas La Candelaria",
      phone: "+57 314 555 8899",
      email: "admin.candelaria@boltpets.com",
      isGuest: false
    },
    deliveryAddress: {
      address: "Calle 11 #15-53, La Candelaria / Centro, Bogotá",
      details: "Piso 2 Administración",
      porteriaPolicy: "SUBIR_A_PUERTA",
      coordinates: { lat: 4.6028, lng: -74.0754 }
    },
    items: [
      {
        productId: "prod-rc-maxi-15k",
        sku: "RC-MAXI-15KG",
        name: "Royal Canin Maxi Adult Perros Grandes",
        brand: "Royal Canin",
        presentation: "Bulto 15 Kg",
        price: 365000,
        quantity: 1,
        image: "https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=800&auto=format&fit=crop&q=80",
        weightKg: 15,
        requiresPrescription: false,
        picked: true
      }
    ],
    totals: {
      subtotal: 365000,
      discount: 0,
      shipping: 0,
      serviceFee: 0,
      tip: 0,
      total: 365000,
      totalWeightKg: 15
    },
    payment: {
      method: "WOMPI_CARD",
      status: "APROBADO",
      transactionId: "TXN-WMP-CENTRO-01"
    },
    prescriptionReview: {
      status: "NO_REQUIERE"
    },
    fulfillmentStatus: "LISTO_PARA_DESPACHO",
    secretDeliveryCode: "1099",
    estimatedDeliveryMinutes: 30,
    originalPromiseWindow: {
      start: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
      end: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    },
    timestamps: {
      confirmedAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
      prepStartedAt: new Date(Date.now() - 110 * 60 * 1000).toISOString(),
      prepCompletedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString()
    }
  }
];

// src/types.ts
var SCHEDULED_DELIVERY_CONFIG = {
  timezone: "America/Bogota",
  maxDaysAhead: 3,
  maxCapacityPerSlot: 10,
  coverageRadiusMeters: 25000,
  windows: [
    {
      id: "HORARIO_1",
      name: "Horario 1",
      interval: {
        start: "09:00",
        end: "14:00"
      },
      cutoff: {
        hour: 10,
        minute: 0,
        label: "10:00 a. m."
      },
      displayInterval: "09:00–14:00",
      displayIntervalText: "9:00 a. m. a 2:00 p. m.",
      commercialHook: "Pide antes de las 10:00 a. m. y recibe hoy de 9:00 a. m. a 2:00 p. m."
    },
    {
      id: "HORARIO_2",
      name: "Horario 2",
      interval: {
        start: "14:00",
        end: "18:00"
      },
      cutoff: {
        hour: 12,
        minute: 0,
        label: "12:00 m."
      },
      displayInterval: "14:00–18:00",
      displayIntervalText: "2:00 p. m. a 6:00 p. m.",
      commercialHook: "Pide antes de las 12:00 m. y recibe hoy de 2:00 p. m. a 6:00 p. m."
    },
    {
      id: "HORARIO_3",
      name: "Horario 3",
      interval: {
        start: "18:00",
        end: "22:00"
      },
      cutoff: {
        hour: 16,
        minute: 0,
        label: "4:00 p. m."
      },
      displayInterval: "18:00–22:00",
      displayIntervalText: "6:00 p. m. a 10:00 p. m.",
      commercialHook: "Pide antes de las 4:00 p. m. y recibe hoy de 6:00 p. m. a 10:00 p. m."
    }
  ]
};

// src/lib/productAvailability.ts
function getProductPurchaseBlock(product) {
  if (product.source !== "SHOPIFY")
    return null;
  if (product.shopifyStatus !== "ACTIVE")
    return "Producto no disponible";
  if (product.pricePending)
    return "Precio por confirmar";
  if (product.inventoryPending)
    return "Inventario por confirmar";
  if (product.weightVerified !== true)
    return "Peso de envío por confirmar";
  if (product.compliancePending)
    return "Información veterinaria por revisar";
  if (product.requiresShipping === false || product.logisticsBlocked)
    return "Disponibilidad por confirmar";
  return null;
}

// src/lib/deliveryService.ts
var COVERAGE_RADIUS_METERS = 6000;
var MAX_DELIVERY_SECONDS = 1500;
var HEAVY_ORDER_THRESHOLD_GRAMS = 60000;
var MAX_VEHICLE_WEIGHT_GRAMS = 25000;
var SCHEDULED_COVERAGE_RADIUS_METERS = 25000;
var MAX_SCHEDULED_WEIGHT_GRAMS = 300000;
var TURBO_ALLOWED_LOCALITIES = ["KENNEDY", "SUBA", "ENGATIVA"];
function detectBogotaLocality(coords, addressText) {
  const clean = (addressText || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (clean.includes("kennedy") || clean.includes("castilla") || clean.includes("timiza") || clean.includes("tintal") || clean.includes("patio bonito") || clean.includes("carvajal") || clean.includes("mandalay") || clean.includes("bavaria") || clean.includes("villa alsacia")) {
    return "KENNEDY";
  }
  if (clean.includes("suba") || clean.includes("rincon") || clean.includes("tibabuyes") || clean.includes("pinar") || clean.includes("lombardia") || clean.includes("niza") || clean.includes("colina campestre") || clean.includes("colina") || clean.includes("mazuren") || clean.includes("prado veraniego") || clean.includes("san jose de baviera")) {
    return "SUBA";
  }
  if (clean.includes("engativa") || clean.includes("alamos") || clean.includes("villas") || clean.includes("minuto de dios") || clean.includes("quirigua") || clean.includes("normandia") || clean.includes("boyaca real") || clean.includes("santa cecilia") || clean.includes("garces navas") || clean.includes("calle 72")) {
    return "ENGATIVA";
  }
  if (clean.includes("usaquen") || clean.includes("cedritos") || clean.includes("santa barbara") || clean.includes("san patricio") || clean.includes("calle 140") || clean.includes("calle 116") || clean.includes("calle 127") || clean.includes("unicentro") || clean.includes("torca") || clean.includes("santa ana") || clean.includes("la carolina")) {
    return "USAQUEN";
  }
  if (clean.includes("chapinero") || clean.includes("lourdes") || clean.includes("rosales") || clean.includes("chico") || clean.includes("antiguo country") || clean.includes("marly") || clean.includes("javeriana") || clean.includes("el retiro")) {
    return "CHAPINERO";
  }
  if (clean.includes("teusaquillo") || clean.includes("salitre") || clean.includes("palermo") || clean.includes("la soledad") || clean.includes("quinta paredes") || clean.includes("ciudad salitre")) {
    return "TEUSAQUILLO";
  }
  if (clean.includes("fontibon") || clean.includes("modelia") || clean.includes("hayuelos") || clean.includes("capellania") || clean.includes("aeropuerto") || clean.includes("zona franca")) {
    return "FONTIBON";
  }
  if (clean.includes("candelaria") || clean.includes("centro") || clean.includes("santa fe") || clean.includes("martires") || clean.includes("las cruces") || clean.includes("plaza de bolivar")) {
    return "CENTRO_HISTORICO";
  }
  if (clean.includes("bosa") || clean.includes("el recreo") || clean.includes("san pablo")) {
    return "BOSA";
  }
  if (clean.includes("barrios unidos") || clean.includes("castellana") || clean.includes("alcazares") || clean.includes("polo")) {
    return "BARRIOS_UNIDOS";
  }
  if (clean.includes("puente aranda") || clean.includes("ciudad montes")) {
    return "PUENTE_ARANDA";
  }
  if (coords && typeof coords.lat === "number" && typeof coords.lng === "number" && !isNaN(coords.lat) && !isNaN(coords.lng)) {
    const { lat, lng } = coords;
    if (lat >= 4.59 && lat <= 4.665 && lng >= -74.195 && lng <= -74.135) {
      return "KENNEDY";
    }
    if (lat >= 4.71 && lat <= 4.825 && lng >= -74.135 && lng <= -74.045) {
      return "SUBA";
    }
    if (lat >= 4.67 && lat <= 4.73 && lng >= -74.148 && lng <= -74.085) {
      return "ENGATIVA";
    }
    if (lat >= 4.64 && lat <= 4.685 && lng >= -74.165 && lng <= -74.11) {
      return "FONTIBON";
    }
    if (lat >= 4.68 && lat <= 4.8 && lng >= -74.055 && lng <= -74.01) {
      return "USAQUEN";
    }
    if (lat >= 4.625 && lat <= 4.685 && lng >= -74.07 && lng <= -74.03) {
      return "CHAPINERO";
    }
    if (lat >= 4.62 && lat <= 4.665 && lng >= -74.095 && lng <= -74.065) {
      return "TEUSAQUILLO";
    }
    if (lat >= 4.585 && lat <= 4.62 && lng >= -74.085 && lng <= -74.05) {
      return "CENTRO_HISTORICO";
    }
    if (lat >= 4.58 && lat <= 4.63 && lng >= -74.21 && lng <= -74.165) {
      return "BOSA";
    }
    if (lat >= 4.65 && lat <= 4.69 && lng >= -74.09 && lng <= -74.055) {
      return "BARRIOS_UNIDOS";
    }
  }
  return "OTRA_LOCALIDAD_BOGOTA";
}
function getBogotaLocalityName(localityCode) {
  switch (localityCode) {
    case "KENNEDY":
      return "Kennedy";
    case "SUBA":
      return "Suba";
    case "ENGATIVA":
      return "Engativá";
    case "USAQUEN":
      return "Usaquén";
    case "CHAPINERO":
      return "Chapinero";
    case "TEUSAQUILLO":
      return "Teusaquillo";
    case "FONTIBON":
      return "Fontibón";
    case "CENTRO_HISTORICO":
      return "La Candelaria / Centro";
    case "BOSA":
      return "Bosa";
    case "BARRIOS_UNIDOS":
      return "Barrios Unidos";
    case "PUENTE_ARANDA":
      return "Puente Aranda";
    default:
      return "Bogotá D.C.";
  }
}
var DELIVERY_CONFIG = {
  coverageRadiusMeters: COVERAGE_RADIUS_METERS,
  maxDeliverySeconds: MAX_DELIVERY_SECONDS,
  heavyOrderThresholdGrams: HEAVY_ORDER_THRESHOLD_GRAMS,
  maxVehicleWeightGrams: MAX_VEHICLE_WEIGHT_GRAMS,
  scheduledCoverageRadiusMeters: SCHEDULED_COVERAGE_RADIUS_METERS,
  maxScheduledWeightGrams: MAX_SCHEDULED_WEIGHT_GRAMS,
  scheduledDelivery: SCHEDULED_DELIVERY_CONFIG,
  configVersion: "2026.2-SPLIT-SCHEDULED",
  defaultPrepReadySeconds: 180,
  itemPickSeconds: 15,
  courierReadySeconds: 120,
  pickupHandoffSeconds: 60,
  customerHandoffSeconds: 120,
  operationalBufferSeconds: 120,
  averageMotoSpeedKmH: 23,
  urbanRoadFactor: 1.32
};
var DeliveryStatus = {
  ELIGIBLE: "ELIGIBLE",
  OUT_OF_COVERAGE: "OUT_OF_COVERAGE",
  OVER_TIME_LIMIT: "OVER_TIME_LIMIT",
  OUT_OF_STOCK: "OUT_OF_STOCK",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  STORE_CLOSED: "STORE_CLOSED",
  NO_AVAILABLE_WAREHOUSE: "NO_AVAILABLE_WAREHOUSE",
  NO_ELIGIBLE_COURIER: "NO_ELIGIBLE_COURIER",
  ADDRESS_NEEDS_CONFIRMATION: "ADDRESS_NEEDS_CONFIRMATION",
  SCHEDULED_ONLY: "SCHEDULED_ONLY",
  ESTIMATE_UNAVAILABLE: "ESTIMATE_UNAVAILABLE"
};
var BOGOTA_TURBO_WAREHOUSES = [
  {
    id: "HUB_KENNEDY",
    name: "Bolt Pets Kennedy",
    address: "Carrera 79A #2-05, Bogotá, Colombia",
    postalAddress: "Carrera 79A #2-05, Bogotá, Colombia",
    coordinates: { lat: 4.6320297, lng: -74.1516306 },
    shopifyCoordinates: { lat: 4.6320297, lng: -74.1516306 },
    verifiedEntrance: { lat: 4.6320297, lng: -74.1516306 },
    verificationStatus: "VERIFIED",
    verifiedAt: "2026-10-25 14:30 COT",
    verifiedBy: "Coordinador Operativo Bogotá",
    placeId: "ChIJz27b_KENNEDY_BOG",
    shopifyLocationGid: "gid://shopify/Location/115617857816",
    turboEnabled: true,
    isActive: true,
    schedule: "07:00 - 23:00",
    maxDeliveryRadiusKm: 6,
    vehicleMaxWeightKg: 25,
    safetyStockDefault: 2
  },
  {
    id: "HUB_ALAMOS",
    name: "Bolt Pets Álamos",
    address: "Calle 72 #97A-18, Bogotá, Colombia",
    postalAddress: "Calle 72 #97A-18, Bogotá, Colombia",
    coordinates: { lat: 4.7026365, lng: -74.1149105 },
    shopifyCoordinates: { lat: 4.7026365, lng: -74.1149105 },
    verifiedEntrance: { lat: 4.7026365, lng: -74.1149105 },
    verificationStatus: "VERIFIED",
    verifiedAt: "2026-10-25 15:10 COT",
    verifiedBy: "Coordinador Operativo Bogotá",
    placeId: "ChIJ_ALAMOS_ENGATIVA_BOG",
    shopifyLocationGid: "gid://shopify/Location/115617890584",
    turboEnabled: true,
    isActive: true,
    schedule: "07:00 - 23:00",
    maxDeliveryRadiusKm: 6,
    vehicleMaxWeightKg: 25,
    safetyStockDefault: 2
  },
  {
    id: "HUB_SUBA",
    name: "Bolt Pets Suba",
    address: "Carrera 107 #143-31, Bogotá, Colombia",
    postalAddress: "Carrera 107 #143-31, Bogotá, Colombia",
    coordinates: { lat: 4.747154, lng: -74.098137 },
    shopifyCoordinates: { lat: 4.747154, lng: -74.098137 },
    verifiedEntrance: { lat: 4.747154, lng: -74.098137 },
    verificationStatus: "VERIFIED",
    verifiedAt: "2026-10-25 15:45 COT",
    verifiedBy: "Coordinador Operativo Bogotá",
    placeId: "ChIJ_SUBA_PINAR_BOG",
    shopifyLocationGid: "gid://shopify/Location/115617923352",
    turboEnabled: true,
    isActive: true,
    schedule: "07:00 - 23:00",
    maxDeliveryRadiusKm: 6,
    vehicleMaxWeightKg: 25,
    safetyStockDefault: 2
  },
  {
    id: "HUB_CENTRO",
    name: "Sede Centro Histórico",
    address: "Calle 11 #15-53, La Candelaria / Centro, Bogotá",
    postalAddress: "Calle 11 #15-53, La Candelaria / Centro, Bogotá",
    coordinates: { lat: 4.6028, lng: -74.0754 },
    shopifyCoordinates: { lat: 4.6028, lng: -74.0754 },
    verifiedEntrance: { lat: 4.6028, lng: -74.0754 },
    verificationStatus: "VERIFIED",
    verifiedAt: "2026-10-20 10:00 COT",
    verifiedBy: "Administración General",
    shopifyLocationGid: "gid://shopify/Location/115617999999",
    turboEnabled: false,
    isActive: true,
    schedule: "08:00 - 20:00",
    maxDeliveryRadiusKm: 5,
    vehicleMaxWeightKg: 15,
    safetyStockDefault: 5
  }
];
function getStoreDispatchCoordinates(store) {
  return store.verifiedEntrance || store.shopifyCoordinates || store.coordinates;
}
function haversine(coord1OrLat1, coord2OrLon1, lat2, lon2) {
  let phi1;
  let phi2;
  let deltaPhi;
  let deltaLambda;
  if (typeof coord1OrLat1 === "object" && typeof coord2OrLon1 === "object") {
    phi1 = coord1OrLat1.lat * Math.PI / 180;
    phi2 = coord2OrLon1.lat * Math.PI / 180;
    deltaPhi = (coord2OrLon1.lat - coord1OrLat1.lat) * Math.PI / 180;
    deltaLambda = (coord2OrLon1.lng - coord1OrLat1.lng) * Math.PI / 180;
  } else if (typeof coord1OrLat1 === "number" && typeof coord2OrLon1 === "number" && typeof lat2 === "number" && typeof lon2 === "number") {
    phi1 = coord1OrLat1 * Math.PI / 180;
    phi2 = lat2 * Math.PI / 180;
    deltaPhi = (lat2 - coord1OrLat1) * Math.PI / 180;
    deltaLambda = (lon2 - coord2OrLon1) * Math.PI / 180;
  } else {
    return 0;
  }
  const R = 6371000;
  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}
function estimateRoadTravel(origin, destination, customRoadFactor) {
  const geodesicMeters = haversine(origin, destination);
  const roadFactor = customRoadFactor || DELIVERY_CONFIG.urbanRoadFactor;
  const roadDistanceMeters = Math.round(geodesicMeters * roadFactor);
  const speedMps = DELIVERY_CONFIG.averageMotoSpeedKmH * 1000 / 3600;
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
var SPANISH_DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
var SPANISH_MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
];
var OFFICIAL_SCHEDULED_WINDOWS = [
  {
    windowId: "HORARIO_1",
    windowName: "Horario 1",
    startTime: "09:00",
    endTime: "14:00",
    displayWindow: "09:00–14:00",
    displayWindowShort: "9:00–2:00 p. m.",
    displayWindowFull: "9:00 a. m. a 2:00 p. m.",
    cutoffHour: 10,
    cutoffMinute: 0,
    cutoffLabel: "10:00 a. m.",
    commercialHook: "Pide antes de las 10:00 a. m. y recibe hoy de 9:00 a. m. a 2:00 p. m."
  },
  {
    windowId: "HORARIO_2",
    windowName: "Horario 2",
    startTime: "14:00",
    endTime: "18:00",
    displayWindow: "14:00–18:00",
    displayWindowShort: "2:00–6:00 p. m.",
    displayWindowFull: "2:00 p. m. a 6:00 p. m.",
    cutoffHour: 12,
    cutoffMinute: 0,
    cutoffLabel: "12:00 m.",
    commercialHook: "Pide antes de las 12:00 m. y recibe hoy de 2:00 p. m. a 6:00 p. m."
  },
  {
    windowId: "HORARIO_3",
    windowName: "Horario 3",
    startTime: "18:00",
    endTime: "22:00",
    displayWindow: "18:00–22:00",
    displayWindowShort: "6:00–10:00 p. m.",
    displayWindowFull: "6:00 p. m. a 10:00 p. m.",
    cutoffHour: 16,
    cutoffMinute: 0,
    cutoffLabel: "4:00 p. m.",
    commercialHook: "Pide antes de las 4:00 p. m. y recibe hoy de 6:00 p. m. a 10:00 p. m."
  }
];
function getBogotaTime(referenceDate = new Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(referenceDate);
  const map = {};
  for (const p of parts)
    map[p.type] = p.value;
  const year = parseInt(map.year, 10);
  const month = parseInt(map.month, 10) - 1;
  const day = parseInt(map.day, 10);
  const rawHour = parseInt(map.hour, 10);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = parseInt(map.minute, 10);
  const dateString = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, hour, minute, dateString };
}
function generateScheduledSlots(referenceDate = new Date, options = {}) {
  const { includeExpired = false, maxDays = 3 } = options;
  const slots = [];
  const bogota = getBogotaTime(referenceDate);
  const currentTotalMinutes = bogota.hour * 60 + bogota.minute;
  for (let dayOffset = 0;dayOffset < maxDays; dayOffset++) {
    const baseDate = new Date(Date.UTC(bogota.year, bogota.month, bogota.day + dayOffset, 12, 0, 0));
    const yyyy = baseDate.getUTCFullYear();
    const mm = String(baseDate.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(baseDate.getUTCDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const dayOfWeek = baseDate.getUTCDay();
    let dayPrefix = "";
    if (dayOffset === 0)
      dayPrefix = "Hoy, ";
    else if (dayOffset === 1)
      dayPrefix = "Mañana, ";
    else
      dayPrefix = `${SPANISH_DAYS[dayOfWeek]}, `;
    const dateLabel = `${dayPrefix}${baseDate.getUTCDate()} de ${SPANISH_MONTHS[baseDate.getUTCMonth()]}`;
    for (const win of OFFICIAL_SCHEDULED_WINDOWS) {
      const isToday = dayOffset === 0;
      let cutoffPassed = false;
      let countdownNotice = undefined;
      let minutesUntilCutoff = undefined;
      let commercialHook = "";
      if (isToday) {
        const cutoffTotalMinutes = win.cutoffHour * 60 + win.cutoffMinute;
        const minutesRemaining = cutoffTotalMinutes - currentTotalMinutes;
        if (minutesRemaining <= 0) {
          cutoffPassed = true;
        } else {
          minutesUntilCutoff = minutesRemaining;
          if (minutesRemaining <= 60) {
            countdownNotice = `⏰ Últimos ${minutesRemaining} minutos para elegir esta franja`;
          }
        }
        commercialHook = win.commercialHook;
      } else {
        cutoffPassed = false;
        commercialHook = `Recibe el ${dateLabel} de ${win.displayWindowFull}`;
      }
      if (cutoffPassed && !includeExpired) {
        continue;
      }
      slots.push({
        slotId: `SLOT-${dateStr}-${win.windowId}`,
        windowId: win.windowId,
        windowName: win.windowName,
        date: dateStr,
        dateLabel,
        startTime: win.startTime,
        endTime: win.endTime,
        displayWindow: win.displayWindow,
        displayWindowShort: win.displayWindowShort,
        displayWindowFull: win.displayWindowFull,
        bookingCutoffTime: `${String(win.cutoffHour).padStart(2, "0")}:${String(win.cutoffMinute).padStart(2, "0")}`,
        bookingCutoffLabel: win.cutoffLabel,
        commercialHook,
        countdownNotice,
        minutesUntilCutoff,
        availableCapacity: cutoffPassed ? 0 : isToday ? 8 : 10,
        maxCapacity: 10,
        cutoffPassed,
        price: 0
      });
    }
  }
  return slots;
}
function validateScheduledBooking(slot, referenceDate = new Date) {
  const bogota = getBogotaTime(referenceDate);
  const isToday = slot.date === bogota.dateString;
  if (!isToday) {
    if (slot.date < bogota.dateString) {
      return { valid: false, reason: "No es posible programar entregas en fechas pasadas." };
    }
    return { valid: true };
  }
  const winDef = OFFICIAL_SCHEDULED_WINDOWS.find((w) => w.windowId === slot.windowId || slot.slotId?.includes(w.windowId) || slot.startTime === w.startTime);
  if (!winDef) {
    return { valid: false, reason: "Franja horaria programada no reconocida." };
  }
  const currentTotalMinutes = bogota.hour * 60 + bogota.minute;
  const cutoffTotalMinutes = winDef.cutoffHour * 60 + winDef.cutoffMinute;
  if (currentTotalMinutes >= cutoffTotalMinutes) {
    return {
      valid: false,
      reason: `La franja ${winDef.windowName} para entrega hoy cerró a las ${winDef.cutoffLabel}. Por favor selecciona otra franja disponible o para mañana.`
    };
  }
  if (winDef.windowId === "HORARIO_1" && currentTotalMinutes >= 9 * 60) {
    if (currentTotalMinutes >= 10 * 60) {
      return {
        valid: false,
        reason: "El Horario 1 cerró a las 10:00 a. m. para entregas hoy."
      };
    }
  }
  return { valid: true };
}
function generateSplitDeliveryPlan(rawItems, catalogProducts, estimatedTravelSeconds, maxVehicleCapacityGrams = MAX_VEHICLE_WEIGHT_GRAMS) {
  const discreteUnits = [];
  let totalOrderWeightGrams = 0;
  for (const item of rawItems) {
    const prod = catalogProducts.find((p) => p.id === item.productId);
    const unitWeightKg = prod?.weightKg || 0.2;
    const unitWeightGrams = Math.round(unitWeightKg * 1000);
    const unitPrice = prod?.price || 0;
    const name = prod?.name || `Producto ${item.productId}`;
    for (let q = 0;q < item.quantity; q++) {
      discreteUnits.push({
        productId: item.productId,
        name,
        weightKg: unitWeightKg,
        weightGrams: unitWeightGrams,
        price: unitPrice
      });
      totalOrderWeightGrams += unitWeightGrams;
    }
  }
  discreteUnits.sort((a, b) => b.weightGrams - a.weightGrams);
  const bins = [];
  let hasOversizedUnit = false;
  for (const unit of discreteUnits) {
    if (unit.weightGrams > maxVehicleCapacityGrams) {
      hasOversizedUnit = true;
    }
    let placed = false;
    for (const bin of bins) {
      if (bin.currentWeightGrams + unit.weightGrams <= maxVehicleCapacityGrams) {
        bin.units.push(unit);
        bin.currentWeightGrams += unit.weightGrams;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bins.push({
        units: [unit],
        currentWeightGrams: unit.weightGrams
      });
    }
  }
  const shipments = bins.map((bin, index) => {
    const groupedMap = new Map;
    for (const u of bin.units) {
      const existing = groupedMap.get(u.productId);
      if (existing) {
        existing.quantity += 1;
        existing.totalWeightGrams += u.weightGrams;
        existing.totalWeightKg = Number((existing.totalWeightGrams / 1000).toFixed(2));
      } else {
        groupedMap.set(u.productId, {
          productId: u.productId,
          name: u.name,
          quantity: 1,
          unitWeightKg: u.weightKg,
          totalWeightKg: u.weightKg,
          totalWeightGrams: u.weightGrams,
          price: u.price
        });
      }
    }
    const items = Array.from(groupedMap.values());
    const subtotal = items.reduce((acc, it) => acc + it.price * it.quantity, 0);
    const weightGrams = bin.currentWeightGrams;
    const weightKg = Number((weightGrams / 1000).toFixed(2));
    const { totalSeconds } = computeTotalETASeconds(estimatedTravelSeconds, bin.units.length);
    return {
      shipmentIndex: index + 1,
      shipmentId: `SHP-${Date.now().toString().slice(-4)}-${index + 1}`,
      items,
      weightKg,
      weightGrams,
      subtotal,
      cashToCollect: subtotal,
      estimatedArrivalSeconds: totalSeconds,
      secretDeliveryCode: Math.floor(1000 + Math.random() * 9000).toString()
    };
  });
  const allShipmentsMeetDeadline = shipments.every((s) => s.estimatedArrivalSeconds <= DELIVERY_CONFIG.maxDeliverySeconds);
  const feasible = !hasOversizedUnit && bins.length <= 4 && allShipmentsMeetDeadline;
  const totalWeightKg = Number((totalOrderWeightGrams / 1000).toFixed(2));
  return {
    totalWeightKg,
    totalWeightGrams: totalOrderWeightGrams,
    thresholdGrams: HEAVY_ORDER_THRESHOLD_GRAMS,
    shipmentCount: shipments.length,
    maxWeightPerVehicleKg: Number((maxVehicleCapacityGrams / 1000).toFixed(0)),
    shipments,
    commonDeadlineSeconds: DELIVERY_CONFIG.maxDeliverySeconds,
    allShipmentsMeetDeadline,
    feasible,
    explanation: feasible ? `Tu pedido pesa ${totalWeightKg} kg (> 60 kg). Se dividirá en ${shipments.length} envíos Turbo en moto simultáneos con llegada en menos de 25 min.` : `Tu pedido pesa ${totalWeightKg} kg y requiere despacho mediante Envío Programado en vehículo de carga.`
  };
}
function evaluateDeliveryQuote(req, stores = BOGOTA_TURBO_WAREHOUSES, catalogProducts = []) {
  const { destination, items } = req;
  const now = new Date;
  const quoteId = `QUO-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  const scheduledSlots = generateScheduledSlots(now);
  const seenItems = new Set;
  for (const item of items || []) {
    const product = catalogProducts.find((p) => p.id === item.productId);
    const invalidQuantity = !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || seenItems.has(item.productId);
    seenItems.add(item.productId);
    const missingProduct = catalogProducts.length > 0 && !product;
    const blocked = product ? getProductPurchaseBlock(product) : null;
    if (invalidQuantity || missingProduct || blocked) {
      return {
        quoteId,
        eligibilityStatus: DeliveryStatus.ESTIMATE_UNAVAILABLE,
        reasonCode: invalidQuantity ? "INVALID_BASKET" : missingProduct ? "PRODUCT_NOT_FOUND" : "PRODUCT_DATA_PENDING",
        message: blocked ? `${product.name}: ${blocked}.` : "Revisa los productos y cantidades de tu pedido.",
        availableModes: { turbo: false, turboDividido: false, scheduled: false },
        recommendedMode: null,
        destination,
        geographicDistanceMeters: 0,
        geographicDistanceKm: 0,
        roadDistanceMeters: 0,
        roadDistanceKm: 0,
        scheduledEligible: false,
        scheduledSlots: [],
        calculatedAt: now.toISOString(),
        expiresAt,
        configVersion: DELIVERY_CONFIG.configVersion,
        candidateWarehousesEvaluated: 0,
        basketValidated: false,
        totalWeightKg: 0,
        totalWeightGrams: 0
      };
    }
  }
  let totalWeightGrams = 0;
  if (items && items.length > 0 && catalogProducts.length > 0) {
    for (const it of items) {
      const prod = catalogProducts.find((p) => p.id === it.productId);
      const unitWeight = prod?.weightKg || 0.2;
      totalWeightGrams += Math.round(unitWeight * 1000) * it.quantity;
    }
  }
  const totalWeightKg = Number((totalWeightGrams / 1000).toFixed(2));
  if (!destination || !destination.coordinates || typeof destination.coordinates.lat !== "number" || typeof destination.coordinates.lng !== "number" || isNaN(destination.coordinates.lat) || isNaN(destination.coordinates.lng)) {
    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.ADDRESS_NEEDS_CONFIRMATION,
      reasonCode: "MISSING_COORDINATES",
      message: "Por favor confirma el punto exacto de entrega en el mapa.",
      availableModes: { turbo: false, turboDividido: false, scheduled: false },
      recommendedMode: null,
      destination: destination || { address: "", coordinates: { lat: 0, lng: 0 } },
      geographicDistanceMeters: 0,
      geographicDistanceKm: 0,
      roadDistanceMeters: 0,
      roadDistanceKm: 0,
      scheduledEligible: false,
      scheduledSlots: [],
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: 0,
      basketValidated: false,
      totalWeightKg: 0,
      totalWeightGrams: 0
    };
  }
  const detectedLocality = detectBogotaLocality(destination.coordinates, destination.address);
  const detectedLocalityName = getBogotaLocalityName(detectedLocality);
  const isTurboLocality = TURBO_ALLOWED_LOCALITIES.includes(detectedLocality);
  const activeTurboStores = stores.filter((s) => s.isActive && s.turboEnabled);
  let minGlobalGeoDistance = Infinity;
  for (const s of stores.filter((st) => st.isActive)) {
    const d = haversine(getStoreDispatchCoordinates(s), destination.coordinates);
    if (d < minGlobalGeoDistance)
      minGlobalGeoDistance = d;
  }
  const isWithinScheduledCoverage = minGlobalGeoDistance <= DELIVERY_CONFIG.scheduledCoverageRadiusMeters;
  if (!isWithinScheduledCoverage) {
    let minTurboGeoDistance = Infinity;
    for (const store of activeTurboStores) {
      const d = haversine(getStoreDispatchCoordinates(store), destination.coordinates);
      if (d < minTurboGeoDistance)
        minTurboGeoDistance = d;
    }
    const geoKm = Number((minTurboGeoDistance / 1000).toFixed(1));
    const roadKm = Number((minTurboGeoDistance * DELIVERY_CONFIG.urbanRoadFactor / 1000).toFixed(1));
    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.OUT_OF_COVERAGE,
      reasonCode: "OUT_OF_ALL_COVERAGE",
      message: "Dirección fuera del perímetro metropolitano de Bogotá.",
      availableModes: { turbo: false, turboDividido: false, scheduled: false },
      recommendedMode: null,
      autoSwitchedToScheduled: false,
      detectedLocality,
      detectedLocalityName,
      isTurboLocality: false,
      destination,
      geographicDistanceMeters: minTurboGeoDistance,
      geographicDistanceKm: geoKm,
      roadDistanceMeters: Math.round(minTurboGeoDistance * DELIVERY_CONFIG.urbanRoadFactor),
      roadDistanceKm: roadKm,
      scheduledEligible: false,
      scheduledSlots: [],
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: activeTurboStores.length,
      basketValidated: !!items?.length,
      totalWeightKg,
      totalWeightGrams
    };
  }
  if (!isTurboLocality) {
    let minTurboGeoDistance = Infinity;
    for (const store of activeTurboStores) {
      const d = haversine(getStoreDispatchCoordinates(store), destination.coordinates);
      if (d < minTurboGeoDistance)
        minTurboGeoDistance = d;
    }
    const geoKm = Number((minTurboGeoDistance / 1000).toFixed(1));
    const roadKm = Number((minTurboGeoDistance * DELIVERY_CONFIG.urbanRoadFactor / 1000).toFixed(1));
    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.SCHEDULED_ONLY,
      reasonCode: "NON_TURBO_LOCALITY_AUTO_SCHEDULED",
      message: "Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido",
      availableModes: {
        turbo: false,
        turboDividido: false,
        scheduled: true
      },
      recommendedMode: "PROGRAMADO",
      autoSwitchedToScheduled: true,
      switchReason: "LOCALITY_NOT_TURBO",
      detectedLocality,
      detectedLocalityName,
      isTurboLocality: false,
      destination,
      geographicDistanceMeters: minTurboGeoDistance,
      geographicDistanceKm: geoKm,
      roadDistanceMeters: Math.round(minTurboGeoDistance * DELIVERY_CONFIG.urbanRoadFactor),
      roadDistanceKm: roadKm,
      scheduledEligible: true,
      scheduledSlots,
      scheduledExplanation: `Turbo y Turbo Dividido aplican exclusivamente en Kennedy, Suba y Engativá. Para ${detectedLocalityName}, continuamos con Envío Programado.`,
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: activeTurboStores.length,
      basketValidated: !!items?.length,
      totalWeightKg,
      totalWeightGrams
    };
  }
  if (activeTurboStores.length === 0) {
    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.SCHEDULED_ONLY,
      reasonCode: "NO_ACTIVE_TURBO_STORES",
      message: "Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido",
      availableModes: { turbo: false, turboDividido: false, scheduled: true },
      recommendedMode: "PROGRAMADO",
      autoSwitchedToScheduled: true,
      switchReason: "TURBO_CONDITIONS_NOT_MET",
      detectedLocality,
      detectedLocalityName,
      isTurboLocality: true,
      destination,
      geographicDistanceMeters: 0,
      geographicDistanceKm: 0,
      roadDistanceMeters: 0,
      roadDistanceKm: 0,
      scheduledEligible: true,
      scheduledSlots,
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: 0,
      basketValidated: false,
      totalWeightKg,
      totalWeightGrams
    };
  }
  const candidates = [];
  const itemCount = items ? items.reduce((acc, i) => acc + i.quantity, 0) : 1;
  for (const store of activeTurboStores) {
    const storeOrigin = getStoreDispatchCoordinates(store);
    const geoDistanceMeters = haversine(storeOrigin, destination.coordinates);
    if (geoDistanceMeters <= DELIVERY_CONFIG.coverageRadiusMeters) {
      let stockSufficient = true;
      if (items && items.length > 0 && catalogProducts.length > 0) {
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
      const { roadDistanceMeters, travelSeconds } = estimateRoadTravel(storeOrigin, destination.coordinates);
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
    let minTurboGeoDistance = Infinity;
    for (const store of activeTurboStores) {
      const d = haversine(getStoreDispatchCoordinates(store), destination.coordinates);
      if (d < minTurboGeoDistance)
        minTurboGeoDistance = d;
    }
    const geoKm = Number((minTurboGeoDistance / 1000).toFixed(1));
    const roadKm = Number((minTurboGeoDistance * DELIVERY_CONFIG.urbanRoadFactor / 1000).toFixed(1));
    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.SCHEDULED_ONLY,
      reasonCode: "DISTANCE_EXCEEDS_6KM_AUTO_SCHEDULED",
      message: "Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido",
      availableModes: {
        turbo: false,
        turboDividido: false,
        scheduled: true
      },
      recommendedMode: "PROGRAMADO",
      autoSwitchedToScheduled: true,
      switchReason: "TURBO_CONDITIONS_NOT_MET",
      detectedLocality,
      detectedLocalityName,
      isTurboLocality: true,
      destination,
      geographicDistanceMeters: minTurboGeoDistance,
      geographicDistanceKm: geoKm,
      roadDistanceMeters: Math.round(minTurboGeoDistance * DELIVERY_CONFIG.urbanRoadFactor),
      roadDistanceKm: roadKm,
      scheduledEligible: true,
      scheduledSlots,
      scheduledExplanation: "Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido",
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: activeTurboStores.length,
      basketValidated: !!items?.length,
      totalWeightKg,
      totalWeightGrams
    };
  }
  const stockEligibleCandidates = candidates.filter((c) => c.stockSufficient);
  if (items && items.length > 0 && stockEligibleCandidates.length === 0) {
    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.SCHEDULED_ONLY,
      reasonCode: "OUT_OF_STOCK_AUTO_SCHEDULED",
      message: "Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido",
      availableModes: {
        turbo: false,
        turboDividido: false,
        scheduled: true
      },
      recommendedMode: "PROGRAMADO",
      autoSwitchedToScheduled: true,
      switchReason: "TURBO_CONDITIONS_NOT_MET",
      detectedLocality,
      detectedLocalityName,
      isTurboLocality: true,
      destination,
      geographicDistanceMeters: candidates[0].geoDistanceMeters,
      geographicDistanceKm: Number((candidates[0].geoDistanceMeters / 1000).toFixed(1)),
      roadDistanceMeters: candidates[0].roadDistanceMeters,
      roadDistanceKm: Number((candidates[0].roadDistanceMeters / 1000).toFixed(1)),
      scheduledEligible: true,
      scheduledSlots,
      scheduledExplanation: "Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido",
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: candidates.length,
      basketValidated: true,
      totalWeightKg,
      totalWeightGrams
    };
  }
  const pool = stockEligibleCandidates.length > 0 ? stockEligibleCandidates : candidates;
  const timeEligibleCandidates = pool.filter((c) => c.totalSeconds <= DELIVERY_CONFIG.maxDeliverySeconds);
  if (timeEligibleCandidates.length === 0) {
    const bestCandidate = pool.sort((a, b) => a.totalSeconds - b.totalSeconds)[0];
    return {
      quoteId,
      eligibilityStatus: DeliveryStatus.SCHEDULED_ONLY,
      reasonCode: "ETA_EXCEEDS_25MIN_AUTO_SCHEDULED",
      message: "Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido",
      availableModes: {
        turbo: false,
        turboDividido: false,
        scheduled: true
      },
      recommendedMode: "PROGRAMADO",
      autoSwitchedToScheduled: true,
      switchReason: "TURBO_CONDITIONS_NOT_MET",
      detectedLocality,
      detectedLocalityName,
      isTurboLocality: true,
      destination,
      geographicDistanceMeters: bestCandidate.geoDistanceMeters,
      geographicDistanceKm: Number((bestCandidate.geoDistanceMeters / 1000).toFixed(1)),
      roadDistanceMeters: bestCandidate.roadDistanceMeters,
      roadDistanceKm: Number((bestCandidate.roadDistanceMeters / 1000).toFixed(1)),
      etaComponents: bestCandidate.etaComponents,
      estimatedMinutes: bestCandidate.estimatedMinutes,
      scheduledEligible: true,
      scheduledSlots,
      scheduledExplanation: "Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido",
      calculatedAt: now.toISOString(),
      expiresAt,
      configVersion: DELIVERY_CONFIG.configVersion,
      candidateWarehousesEvaluated: pool.length,
      basketValidated: !!items?.length,
      totalWeightKg,
      totalWeightGrams
    };
  }
  timeEligibleCandidates.sort((a, b) => {
    if (a.totalSeconds !== b.totalSeconds) {
      return a.totalSeconds - b.totalSeconds;
    }
    return a.roadDistanceMeters - b.roadDistanceMeters;
  });
  const winner = timeEligibleCandidates[0];
  const isHeavyOrder = totalWeightGrams > DELIVERY_CONFIG.heavyOrderThresholdGrams;
  if (isHeavyOrder && items && items.length > 0 && catalogProducts.length > 0) {
    const splitPlan = generateSplitDeliveryPlan(items, catalogProducts, winner.roadTravelSeconds, DELIVERY_CONFIG.maxVehicleWeightGrams);
    if (splitPlan.feasible) {
      return {
        quoteId,
        eligibilityStatus: DeliveryStatus.ELIGIBLE,
        reasonCode: "TURBO_DIVIDIDO_ELIGIBLE",
        message: `Tu pedido pesa ${totalWeightKg} kg (> 60 kg). Se entregará en ${splitPlan.shipmentCount} motos Turbo simultáneas en aprox. ${winner.estimatedMinutes} min.`,
        availableModes: {
          turbo: false,
          turboDividido: true,
          scheduled: true
        },
        recommendedMode: "TURBO_DIVIDIDO",
        autoSwitchedToScheduled: false,
        detectedLocality,
        detectedLocalityName,
        isTurboLocality: true,
        assignedStoreId: winner.store.id,
        assignedStoreName: winner.store.name,
        assignedStoreAddress: winner.store.address,
        assignedStoreCoordinates: getStoreDispatchCoordinates(winner.store),
        destination,
        geographicDistanceMeters: winner.geoDistanceMeters,
        geographicDistanceKm: Number((winner.geoDistanceMeters / 1000).toFixed(1)),
        roadDistanceMeters: winner.roadDistanceMeters,
        roadDistanceKm: Number((winner.roadDistanceMeters / 1000).toFixed(1)),
        etaComponents: winner.etaComponents,
        estimatedMinutes: winner.estimatedMinutes,
        turboDividido: splitPlan,
        scheduledEligible: true,
        scheduledSlots,
        calculatedAt: now.toISOString(),
        expiresAt,
        configVersion: DELIVERY_CONFIG.configVersion,
        candidateWarehousesEvaluated: pool.length,
        basketValidated: true,
        totalWeightKg,
        totalWeightGrams
      };
    } else {
      return {
        quoteId,
        eligibilityStatus: DeliveryStatus.SCHEDULED_ONLY,
        reasonCode: "HEAVY_ORDER_SCHEDULED_ONLY",
        message: "Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido",
        availableModes: {
          turbo: false,
          turboDividido: false,
          scheduled: true
        },
        recommendedMode: "PROGRAMADO",
        autoSwitchedToScheduled: true,
        switchReason: "WEIGHT_OVERSIZED",
        detectedLocality,
        detectedLocalityName,
        isTurboLocality: true,
        assignedStoreId: winner.store.id,
        assignedStoreName: winner.store.name,
        assignedStoreAddress: winner.store.address,
        assignedStoreCoordinates: getStoreDispatchCoordinates(winner.store),
        destination,
        geographicDistanceMeters: winner.geoDistanceMeters,
        geographicDistanceKm: Number((winner.geoDistanceMeters / 1000).toFixed(1)),
        roadDistanceMeters: winner.roadDistanceMeters,
        roadDistanceKm: Number((winner.roadDistanceMeters / 1000).toFixed(1)),
        scheduledEligible: true,
        scheduledSlots,
        scheduledExplanation: "Para esta dirección, continuamos con envío programado. Elige cuándo recibir tu pedido",
        calculatedAt: now.toISOString(),
        expiresAt,
        configVersion: DELIVERY_CONFIG.configVersion,
        candidateWarehousesEvaluated: pool.length,
        basketValidated: true,
        totalWeightKg,
        totalWeightGrams
      };
    }
  }
  return {
    quoteId,
    eligibilityStatus: DeliveryStatus.ELIGIBLE,
    reasonCode: "SUCCESS",
    message: `Entregamos en esta dirección en aprox. ${winner.estimatedMinutes} min desde ${winner.store.name}.`,
    availableModes: {
      turbo: true,
      turboDividido: false,
      scheduled: true
    },
    recommendedMode: "TURBO",
    autoSwitchedToScheduled: false,
    detectedLocality,
    detectedLocalityName,
    isTurboLocality: true,
    assignedStoreId: winner.store.id,
    assignedStoreName: winner.store.name,
    assignedStoreAddress: winner.store.address,
    assignedStoreCoordinates: getStoreDispatchCoordinates(winner.store),
    destination,
    geographicDistanceMeters: winner.geoDistanceMeters,
    geographicDistanceKm: Number((winner.geoDistanceMeters / 1000).toFixed(1)),
    roadDistanceMeters: winner.roadDistanceMeters,
    roadDistanceKm: Number((winner.roadDistanceMeters / 1000).toFixed(1)),
    etaComponents: winner.etaComponents,
    estimatedMinutes: winner.estimatedMinutes,
    scheduledEligible: true,
    scheduledSlots,
    calculatedAt: now.toISOString(),
    expiresAt,
    configVersion: DELIVERY_CONFIG.configVersion,
    candidateWarehousesEvaluated: pool.length,
    basketValidated: !!items?.length,
    totalWeightKg,
    totalWeightGrams
  };
}

// src/lib/shopifyService.ts
var SHOPIFY_CONFIG = {
  storeName: "Agrocentro Pets",
  canonicalDomain: "1c76bc-08.myshopify.com",
  publicDomain: "cultivacenter.com",
  apiVersion: "2026-10",
  readOnlyScopes: ["read_products", "read_inventory", "read_locations"],
  reconciliationIntervalMinutes: 0,
  locations: {
    HUB_KENNEDY: { gid: "gid://shopify/Location/115617857816", name: "Bolt Pets Kennedy", officialAddress: "Carrera 79A #2-05, Bogotá, Colombia" },
    HUB_ALAMOS: { gid: "gid://shopify/Location/115617890584", name: "Bolt Pets Álamos", officialAddress: "Calle 72 #97A-18, Bogotá, Colombia" },
    HUB_SUBA: { gid: "gid://shopify/Location/115617923352", name: "Bolt Pets Suba", officialAddress: "Carrera 107 #143-31, Bogotá, Colombia" },
    HUB_CENTRO: { gid: "gid://shopify/Location/115676021016", name: "Agrocentro Pets - Centro", officialAddress: "Calle 11 #15-53, Bogotá, Colombia" }
  }
};

class ShopifyService {
  constructor() {
    this.syncState = {
      status: "SIN_CONFIGURAR",
      storeDomain: SHOPIFY_CONFIG.canonicalDomain,
      publicDomain: SHOPIFY_CONFIG.publicDomain,
      apiVersion: SHOPIFY_CONFIG.apiVersion,
      readOnlyScopes: [...SHOPIFY_CONFIG.readOnlyScopes],
      reconciliationIntervalMinutes: 0,
      activeWarehousesCount: 0,
      totalMappedSkus: 0,
      unmappedSkusCount: 0,
      discrepanciesCount: 0,
      locations: [],
      inventoryItems: [],
      automaticSync: false
    };
    this.imported = false;
    this.productsById = new Map;
  }
  configureSnapshot({ products, stores, status }) {
    if (!status.complete)
      throw new Error("No se puede instalar una instantánea incompleta de Shopify.");
    for (const item of this.syncState.inventoryItems)
      this.refreshItem(item);
    const previousReservations = new Map(this.syncState.inventoryItems.map((item) => [item.shopifyVariantGid, item.quantitiesByLocation]));
    for (const product of products) {
      for (const storeId of Object.keys(product.inventoryByStore)) {
        product.reservedStockByStore[storeId] = previousReservations.get(product.shopifyVariantGid)?.[storeId]?.reservedBolt ?? product.reservedStockByStore[storeId] ?? 0;
      }
    }
    this.productsById = new Map(products.map((product) => [product.id, product]));
    const inventoryItems = products.map((product) => ({
      productId: product.id,
      sku: product.sku,
      productName: `${product.name} · ${product.presentation}`,
      shopifyProductGid: product.shopifyProductGid,
      shopifyVariantGid: product.shopifyVariantGid,
      shopifyInventoryItemGid: product.shopifyInventoryItemGid,
      quantitiesByLocation: Object.fromEntries(Object.entries(product.inventoryByStore).map(([storeId, level]) => {
        const reservedBolt = previousReservations.get(product.shopifyVariantGid)?.[storeId]?.reservedBolt ?? product.reservedStockByStore[storeId] ?? 0;
        return [storeId, {
          available: level.available,
          onHand: level.onHand,
          committed: level.committed,
          reservedBolt,
          safetyStock: level.quantities.safety_stock ?? 0,
          sellable: level.available === null ? null : Math.max(0, level.available - reservedBolt)
        }];
      })),
      lastUpdated: status.fetchedAt
    }));
    this.syncState = {
      ...status,
      mode: "READ_ONLY_SNAPSHOT",
      status: "SNAPSHOT_IMPORTADO",
      storeDomain: status.shop.myshopifyDomain,
      publicDomain: SHOPIFY_CONFIG.publicDomain,
      apiVersion: status.apiVersion || "",
      readOnlyScopes: [...SHOPIFY_CONFIG.readOnlyScopes],
      lastSuccessfulSync: status.fetchedAt,
      lastAttemptedSync: status.fetchedAt,
      automaticSync: false,
      reconciliationIntervalMinutes: 0,
      activeWarehousesCount: stores.filter((store) => store.isActive).length,
      totalMappedSkus: products.length,
      importedProductCount: status.productsCount,
      importedVariantCount: status.variantCount,
      unmappedSkusCount: 0,
      discrepanciesCount: 0,
      locations: status.locations.map((location) => ({
        ...location,
        storeId: location.storeId,
        storeName: location.name,
        shopifyLocationGid: location.id,
        shopifyLocationName: location.name,
        isActiveInBolt: location.isActive,
        lastSyncAt: status.fetchedAt,
        syncedProductsCount: products.filter((product) => product.inventoryByStore[location.storeId]).length,
        discrepanciesCount: 0
      })),
      inventoryItems
    };
    this.imported = true;
    return this.getState();
  }
  getState() {
    for (const item of this.syncState.inventoryItems)
      this.refreshItem(item);
    return structuredClone(this.syncState);
  }
  refreshItem(item) {
    const product = this.productsById.get(item.productId);
    if (!product)
      return;
    for (const [storeId, level] of Object.entries(item.quantitiesByLocation)) {
      const original = product.inventoryByStore[storeId];
      const stock = product.stockByStore[storeId];
      const available = original?.available == null || !Number.isFinite(stock) ? null : stock;
      const reservedBolt = product.reservedStockByStore[storeId] ?? 0;
      level.available = available;
      level.onHand = original?.onHand ?? null;
      level.committed = original?.committed ?? null;
      level.reservedBolt = reservedBolt;
      level.safetyStock = original?.quantities.safety_stock ?? 0;
      level.sellable = available === null ? null : Math.max(0, available - reservedBolt);
    }
  }
  async triggerReconciliation() {
    return this.getState();
  }
  findItem(productIdOrVariantGid) {
    if (!productIdOrVariantGid)
      return;
    const item = this.syncState.inventoryItems.find((item) => item.productId === productIdOrVariantGid || item.shopifyVariantGid === productIdOrVariantGid);
    if (item)
      this.refreshItem(item);
    return item;
  }
  getSellableStock(productIdOrVariantGid, storeId) {
    return this.findItem(productIdOrVariantGid)?.quantitiesByLocation[storeId]?.sellable ?? 0;
  }
  reserveStockLocally(storeId, productIdOrVariantGid, quantity) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0)
      return false;
    const item = this.findItem(productIdOrVariantGid);
    const level = item?.quantitiesByLocation[storeId];
    if (!level || level.sellable == null || level.sellable < quantity || level.available == null)
      return false;
    const product = this.productsById.get(item.productId);
    if (!product)
      return false;
    product.reservedStockByStore[storeId] = level.reservedBolt + quantity;
    this.refreshItem(item);
    return true;
  }
  updateLocationStock(_storeId, _productId, _newOnHand, _committed = 0) {
    return {
      success: false,
      error: this.imported ? "La instantánea Shopify es de solo lectura. El simulador no puede alterar las existencias importadas." : "Falta importar un inventario autorizado de Shopify."
    };
  }
}
var shopifyService = new ShopifyService;

// lib/shopifyRuntime.ts
import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";

// src/lib/shopifyMapper.ts
var KNOWN_LOCATIONS = {
  "115617857816": "HUB_KENNEDY",
  "115617890584": "HUB_ALAMOS",
  "115617923352": "HUB_SUBA",
  "115676021016": "HUB_CENTRO"
};
var TURBO_STORES = new Set(["HUB_KENNEDY", "HUB_ALAMOS", "HUB_SUBA"]);
function numericGid(id, entity) {
  const match = new RegExp("^gid://shopify/" + entity + "/([0-9]+)$").exec(String(id || ""));
  if (!match)
    throw new Error("Identificador Shopify inválido para " + entity + ".");
  return match[1];
}
function storeId(id) {
  const number = numericGid(id, "Location");
  return KNOWN_LOCATIONS[number] || "SHOPIFY_LOCATION_" + number;
}
function coordinates(location) {
  const lat = location.address?.latitude, lng = location.address?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return null;
  return { lat, lng };
}
function clean(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function categoryFor(product) {
  const values = [product.productType || "", ...product.tags || []].map(clean);
  const labels = values.join(" ");
  const has = (needle) => labels.includes(needle);
  const dogs = has("perro") || has("canino"), cats = has("gato") || has("felino");
  const species = dogs && cats ? "Ambos" : dogs ? "Perro" : cats ? "Gato" : "Otros";
  if (has("farmacia") || has("medicamento") || has("antiparasit") || has("suplement") || has("dermatolog") || has("veterinari")) {
    const pharmacySubcategory = has("antipulga") || has("garrapata") ? "Antipulgas y garrapatas" : has("desparasit") || has("antiparasit") ? "Desparasitación" : has("dermatolog") ? "Dermatología" : has("vitamina") || has("suplement") ? "Vitaminas y suplementos" : "Medicamentos veterinarios";
    return { category: "Farmacia", pharmacySubcategory, species };
  }
  if (has("arena"))
    return { category: "Arenas", species };
  if (has("snack") || has("premio") || has("golosina"))
    return { category: "Snacks", species };
  if (has("higiene") || has("shampoo") || has("toallita") || has("limpieza"))
    return { category: "Higiene", species };
  if (has("accesorio") || has("juguete") || has("collar") || has("arnes") || has("correa") || has("cama"))
    return { category: "Accesorios", species };
  if (has("alimento") || has("comida") || has("concentrado"))
    return { category: "Alimentos", species };
  return { category: "Todo", species };
}
function imageUrls(media) {
  return (media?.nodes || []).flatMap((node) => {
    const url = node.image?.url;
    if (!url)
      return [];
    try {
      return new URL(url).protocol === "https:" ? [url] : [];
    } catch {
      return [];
    }
  });
}
function amount(value) {
  if (value === null || value === undefined || value === "")
    return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
function shopifyShippingWeightKg(variant) {
  const measurement = variant.inventoryItem?.measurement?.weight;
  const value = measurement?.value;
  const scale = { KILOGRAMS: 1, GRAMS: 0.001, POUNDS: 0.45359237, OUNCES: 0.028349523125 };
  const multiplier = scale[String(measurement?.unit || "").toUpperCase()];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || !multiplier)
    return null;
  return Number((value * multiplier).toFixed(9));
}
function normalizeShopifySnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.locations) || !Array.isArray(snapshot.variants))
    throw new Error("La instantánea Shopify no contiene ubicaciones y variantes válidas.");
  if (!snapshot.fetchedAt || !Number.isFinite(Date.parse(snapshot.fetchedAt)))
    throw new Error("La instantánea Shopify necesita una fecha de lectura válida.");
  const seenLocations = new Set;
  const locationStatus = snapshot.locations.map((location) => {
    if (seenLocations.has(location.id))
      throw new Error("La instantánea repite una ubicación Shopify.");
    seenLocations.add(location.id);
    const id = storeId(location.id), coords = coordinates(location);
    const postalAddress = [location.address?.address1, location.address?.address2, location.address?.city, location.address?.country].filter(Boolean).join(", ");
    return {
      id: location.id,
      storeId: id,
      name: location.name,
      isActive: !!location.isActive,
      fulfillsOnlineOrders: typeof location.fulfillsOnlineOrders === "boolean" ? location.fulfillsOnlineOrders : null,
      hasCoordinates: !!coords,
      coordinates: coords,
      address: postalAddress,
      turboEnabled: !!coords && !!location.isActive && location.fulfillsOnlineOrders !== false && TURBO_STORES.has(id)
    };
  });
  const stores = locationStatus.flatMap((location) => {
    if (!location.coordinates)
      return [];
    const coords = { ...location.coordinates };
    return [{
      id: location.storeId,
      name: location.name,
      address: location.address,
      postalAddress: location.address,
      coordinates: coords,
      shopifyCoordinates: { ...coords },
      verificationStatus: "UNVERIFIED",
      shopifyLocationGid: location.id,
      turboEnabled: location.turboEnabled,
      isActive: location.isActive,
      schedule: "Horario pendiente de confirmar",
      maxDeliveryRadiusKm: 6,
      vehicleMaxWeightKg: 25,
      safetyStockDefault: 0,
      source: "SHOPIFY",
      coordinatesSource: "SHOPIFY_ADDRESS",
      hasCoordinates: true,
      fulfillsOnlineOrders: location.fulfillsOnlineOrders
    }];
  });
  const seenVariants = new Set;
  const products = snapshot.variants.map((variant) => {
    const variantNumber = numericGid(variant.id, "ProductVariant");
    numericGid(variant.product.id, "Product");
    if (seenVariants.has(variant.id))
      throw new Error("La instantánea repite una variante Shopify.");
    seenVariants.add(variant.id);
    const product = variant.product, tags = (product.tags || []).map(String);
    const normalizedTags = tags.map(clean);
    const classification = categoryFor(product);
    const priceValue = amount(variant.price), price = priceValue ?? 0;
    const compareAt = amount(variant.compareAtPrice);
    const pricePending = priceValue === null || price <= 1 || normalizedTags.includes("precio-pendiente");
    const shippingWeightKg = shopifyShippingWeightKg(variant);
    const weightVerified = shippingWeightKg !== null;
    const gallery = [...new Set([...imageUrls(variant.media), ...imageUrls(product.media)])];
    const selectedOptions = (variant.selectedOptions || []).map((option) => ({ name: String(option.name), value: String(option.value) }));
    const optionsTitle = selectedOptions.filter((option) => clean(option.name) !== "title" && clean(option.value) !== "default title").map((option) => option.value).join(" / ");
    const sizeTitle = clean(variant.title) === "default title" ? optionsTitle : String(variant.title || optionsTitle);
    const presentation = sizeTitle || optionsTitle || "Presentación no especificada";
    const inventoryByStore = {};
    const stockByStore = {}, reservedStockByStore = {};
    for (const location of locationStatus) {
      stockByStore[location.storeId] = 0;
      reservedStockByStore[location.storeId] = 0;
    }
    let quantityMissing = false;
    for (const level of variant.inventoryItem?.inventoryLevels?.nodes || []) {
      const id = storeId(level.location.id);
      const quantities = {};
      for (const q of level.quantities || [])
        if (typeof q.quantity === "number" && Number.isFinite(q.quantity))
          quantities[q.name] = q.quantity;
      const available = quantities.available ?? null;
      if (available === null)
        quantityMissing = true;
      inventoryByStore[id] = { locationGid: level.location.id, available, onHand: quantities.on_hand ?? null, committed: quantities.committed ?? null, quantities };
      stockByStore[id] = available ?? 0;
      reservedStockByStore[id] = 0;
    }
    const inventoryPending = normalizedTags.includes("inventario-pendiente") || !variant.inventoryItem?.tracked || quantityMissing || !variant.inventoryItem?.inventoryLevels?.nodes?.length;
    const requiresShipping = typeof variant.inventoryItem?.requiresShipping === "boolean" ? variant.inventoryItem.requiresShipping : null;
    const compliancePending = classification.category === "Farmacia";
    const qualityIssues = [
      ...!weightVerified ? ["MISSING_SHIPPING_WEIGHT"] : [],
      ...pricePending ? ["PENDING_PRICE"] : [],
      ...inventoryPending ? ["PENDING_INVENTORY"] : [],
      ...compliancePending ? ["PHARMACY_DATA_REVIEW"] : [],
      ...requiresShipping === false ? ["NON_SHIPPING_VARIANT"] : [],
      ...!gallery.length ? ["MISSING_IMAGE"] : []
    ];
    const originalPrice = !pricePending && compareAt !== null && compareAt > price ? compareAt : undefined;
    return {
      id: "shopify-" + variantNumber,
      sku: variant.sku || "",
      name: product.title,
      brand: product.vendor || "",
      ...classification,
      requiresPrescription: false,
      requiresPrescriptionKnown: !compliancePending,
      prescriptionDataStatus: compliancePending ? "PENDING_REVIEW" : "NOT_APPLICABLE",
      compliancePending,
      storageCondition: "TEMPERATURA_AMBIENTE",
      temperatureColdChain: false,
      price,
      originalPrice,
      discountPercent: originalPrice ? Math.round((1 - price / originalPrice) * 100) : undefined,
      presentation,
      sizeTitle: sizeTitle || presentation,
      selectedOptions,
      weightKg: shippingWeightKg ?? 0,
      shippingWeightKg,
      weightVerified,
      weightSource: weightVerified ? "SHOPIFY_INVENTORY_MEASUREMENT" : "UNKNOWN",
      unitPriceText: undefined,
      image: gallery[0] || "",
      gallery,
      description: product.description || "",
      stockByStore,
      reservedStockByStore,
      inventoryByStore,
      rating: 0,
      reviewsCount: 0,
      ratingVerified: false,
      tags,
      source: "SHOPIFY",
      shopifyProductGid: product.id,
      shopifyVariantGid: variant.id,
      shopifyInventoryItemGid: variant.inventoryItem?.id || null,
      inventoryItemGid: variant.inventoryItem?.id || null,
      shopifyHandle: product.handle,
      shopifyStatus: product.status,
      status: product.status,
      pricePending,
      inventoryPending,
      requiresShipping,
      logisticsBlocked: !weightVerified || pricePending || inventoryPending || compliancePending || requiresShipping === false,
      qualityIssues
    };
  });
  const parents = new Set(products.map((product) => product.shopifyProductGid));
  const activeParents = new Set(products.filter((product) => product.shopifyStatus === "ACTIVE").map((product) => product.shopifyProductGid));
  const complete = snapshot.complete === true && !snapshot.variants.some((variant) => variant.inventoryItem?.inventoryLevels?.pageInfo?.hasNextPage);
  const status = {
    mode: "READ_ONLY_SNAPSHOT",
    source: "SHOPIFY",
    shop: { ...snapshot.shop },
    fetchedAt: snapshot.fetchedAt,
    complete,
    automaticSync: false,
    apiVersion: snapshot.apiVersion || "",
    productCount: parents.size,
    productsCount: parents.size,
    activeProductsCount: activeParents.size,
    variantCount: products.length,
    locationsCount: locationStatus.length,
    locations: locationStatus,
    missingWeights: products.filter((product) => !product.weightVerified).length,
    missingImages: products.filter((product) => !product.image).length,
    pendingPrices: products.filter((product) => product.pricePending).length,
    pendingInventory: products.filter((product) => product.inventoryPending).length,
    pendingPharmacyReview: products.filter((product) => product.compliancePending).length,
    activeVariantsCount: products.filter((product) => product.shopifyStatus === "ACTIVE").length
  };
  return { products, stores, status };
}

// lib/shopify-auth.mjs
var REQUIRED_SCOPES = ["read_products", "read_inventory", "read_locations"];
var RENEW_EARLY_MS = 60000;
var REQUEST_TIMEOUT_MS = 30000;

class ShopifyAuthError extends Error {
  constructor(code, message, metadata = {}) {
    super(message);
    this.name = "ShopifyAuthError";
    this.code = code;
    Object.assign(this, metadata);
  }
}
function assertServer() {
  if (typeof window !== "undefined") {
    throw new ShopifyAuthError("SERVER_ONLY_REQUIRED", "La autorización de Shopify debe ejecutarse únicamente en el servidor.");
  }
}
function canonicalShopDomain(domain) {
  if (typeof domain !== "string")
    throw new ShopifyAuthError("INVALID_DOMAIN", "Configura el dominio canónico de la tienda Shopify.");
  const value = domain.trim().toLowerCase();
  if (value.length > 253 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(value)) {
    throw new ShopifyAuthError("INVALID_DOMAIN", "El dominio debe terminar en .myshopify.com, sin rutas, puertos ni protocolo.");
  }
  return value;
}
function credential(value) {
  if (value === undefined || value === null || value === "")
    return "";
  if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value)) {
    throw new ShopifyAuthError("INVALID_CREDENTIAL", "La configuración de credenciales Shopify no es válida.");
  }
  return value.trim();
}
function createShopifyTokenProvider({
  domain,
  clientId,
  clientSecret,
  accessToken,
  fetchImpl = globalThis.fetch,
  now = Date.now
} = {}) {
  assertServer();
  const shopDomain = canonicalShopDomain(domain);
  let cachedToken = null, expiresAt = 0, inFlight = null;
  function clock() {
    let value;
    try {
      value = now();
    } catch {
      throw new ShopifyAuthError("INVALID_CONFIGURATION", "No se pudo comprobar la vigencia de la autorización Shopify.");
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new ShopifyAuthError("INVALID_CONFIGURATION", "No se pudo comprobar la vigencia de la autorización Shopify.");
    }
    return value;
  }
  async function exchange(id, secret) {
    if (typeof fetchImpl !== "function")
      throw new ShopifyAuthError("FETCH_UNAVAILABLE", "No está disponible la conexión HTTP del servidor.");
    const requestedAt = clock();
    let response;
    try {
      response = await fetchImpl("https://" + shopDomain + "/admin/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }).toString(),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";
      throw new ShopifyAuthError(timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR", timedOut ? "Shopify no respondió a la autorización dentro del tiempo permitido." : "No se pudo conectar con Shopify para autorizar la aplicación.");
    }
    let text;
    try {
      text = await response.text();
    } catch {
      throw new ShopifyAuthError("INVALID_RESPONSE", "No se pudo leer la respuesta de autorización de Shopify.");
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    const status = Number.isInteger(response.status) ? response.status : 502;
    if (!response.ok) {
      if (/\bshop_not_permitted\b/i.test(text.slice(0, 16384))) {
        throw new ShopifyAuthError("SHOP_NOT_PERMITTED", "Esta tienda y la aplicación deben pertenecer a la misma organización Shopify para usar estas credenciales. Si pertenecen a organizaciones distintas, configura la instalación mediante OAuth; no cambies de dominio para intentar autorizar.", { status });
      }
      if (status === 401 || status === 403 || status === 400) {
        throw new ShopifyAuthError("AUTHORIZATION_REQUIRED", "Shopify no autorizó las credenciales. Revisa la aplicación instalada y su configuración de acceso.", { status });
      }
      if (status === 429) {
        throw new ShopifyAuthError("RATE_LIMITED", "Shopify limitó temporalmente la autorización. Intenta nuevamente más tarde.", { status });
      }
      throw new ShopifyAuthError("HTTP_ERROR", "Shopify no pudo completar la autorización de la aplicación.", { status });
    }
    if (!payload || typeof payload !== "object" || typeof payload.access_token !== "string" || !payload.access_token.trim() || /[\s\x00-\x1f\x7f]/.test(payload.access_token) || !Number.isSafeInteger(payload.expires_in) || payload.expires_in <= 0 || typeof payload.scope !== "string") {
      throw new ShopifyAuthError("INVALID_RESPONSE", "La respuesta de autorización de Shopify no contiene un token válido con su vigencia y permisos.");
    }
    const grantedScopes = new Set(payload.scope.split(/[\s,]+/).filter(Boolean));
    const missingScopes = REQUIRED_SCOPES.filter((scope) => !grantedScopes.has(scope));
    if (missingScopes.length) {
      throw new ShopifyAuthError("MISSING_SCOPES", "La aplicación necesita aprobar los permisos de lectura de productos, inventario y ubicaciones en Shopify.", { missingScopes });
    }
    const tokenExpiresAt = requestedAt + payload.expires_in * 1000;
    if (!Number.isSafeInteger(tokenExpiresAt) || tokenExpiresAt <= clock()) {
      throw new ShopifyAuthError("INVALID_RESPONSE", "La respuesta de autorización de Shopify no contiene una vigencia utilizable.");
    }
    cachedToken = payload.access_token;
    expiresAt = tokenExpiresAt;
    return cachedToken;
  }
  async function getToken() {
    assertServer();
    const directToken = credential(accessToken);
    if (directToken)
      return directToken;
    const id = credential(clientId), secret = credential(clientSecret);
    if (!id || !secret) {
      throw new ShopifyAuthError("MISSING_CREDENTIAL", "Configura el Client ID y Client secret de la aplicación Shopify o un token de acceso autorizado en el servidor.");
    }
    if (cachedToken && clock() < expiresAt - RENEW_EARLY_MS)
      return cachedToken;
    if (!inFlight)
      inFlight = exchange(id, secret).finally(() => {
        inFlight = null;
      });
    return inFlight;
  }
  getToken.canRenew = !credential(accessToken);
  getToken.invalidate = () => {
    cachedToken = null;
    expiresAt = 0;
  };
  return getToken;
}

// lib/shopify-queries.mjs
var LOCATIONS_QUERY = `query BoltShopLocations($first: Int!, $after: String) {
  shop { name myshopifyDomain currencyCode }
  locations(first: $first, after: $after, includeInactive: true) {
    nodes { id name isActive fulfillsOnlineOrders address { address1 address2 city country latitude longitude } }
    pageInfo { hasNextPage endCursor }
  }
}`;
var VARIANTS_QUERY = `query BoltVariants($first: Int!, $after: String) {
  productVariants(first: $first, after: $after, sortKey: ID) {
    nodes {
      id title sku price compareAtPrice selectedOptions { name value }
      media(first: 2) { nodes { ... on MediaImage { image { url altText } } } pageInfo { hasNextPage endCursor } }
      product { id title handle status vendor productType tags description media(first: 6) { nodes { ... on MediaImage { image { url altText } } } pageInfo { hasNextPage endCursor } } }
      inventoryItem {
        id tracked requiresShipping measurement { weight { value unit } }
        inventoryLevels(first: 5, includeInactive: true) {
          nodes { location { id } quantities(names: ["available", "on_hand", "committed", "reserved", "safety_stock"]) { name quantity } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
var INVENTORY_LEVELS_QUERY = `query BoltInventoryLevels($id: ID!, $first: Int!, $after: String) {
  inventoryItem(id: $id) {
    id
    inventoryLevels(first: $first, after: $after, includeInactive: true) {
      nodes { location { id } quantities(names: ["available", "on_hand", "committed", "reserved", "safety_stock"]) { name quantity } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

// lib/shopify-readonly.mjs
var PAGE_SIZE = 20;
var MAX_PAGES = 2000;
var MAX_ATTEMPTS = 3;
var REQUEST_TIMEOUT_MS2 = 30000;
var MAX_WAIT_MS = 30000;

class ShopifyReadError extends Error {
  constructor(code, message, metadata = {}) {
    super(message);
    this.name = "ShopifyReadError";
    this.code = code;
    Object.assign(this, metadata);
  }
}
function connection(value, key) {
  if (!value || !Array.isArray(value.nodes) || typeof value.pageInfo?.hasNextPage !== "boolean") {
    throw new ShopifyReadError("INVALID_RESPONSE", "Shopify devolvió datos incompletos para " + key + ".");
  }
  if (value.pageInfo.hasNextPage && (typeof value.pageInfo.endCursor !== "string" || !value.pageInfo.endCursor)) {
    throw new ShopifyReadError("INVALID_CURSOR", "Shopify no devolvió un cursor utilizable para " + key + ".");
  }
  return value;
}
function retryDelay(header, attempt, now) {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0)
      return seconds * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date))
      return Math.max(0, date - now());
  }
  return Math.min(500 * 2 ** attempt, MAX_WAIT_MS);
}
async function readShopifySnapshot({
  domain,
  token,
  tokenProvider,
  apiVersion = "2026-10",
  fetchImpl = globalThis.fetch,
  onProgress,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  if (typeof window !== "undefined")
    throw new ShopifyReadError("SERVER_ONLY_REQUIRED", "La lectura de Shopify pertenece al servidor.");
  const canonicalDomain = String(domain || "").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(canonicalDomain))
    throw new ShopifyReadError("INVALID_DOMAIN", "Configura un dominio canónico de Shopify válido.");
  if (!/^\d{4}-(?:01|04|07|10)$/.test(apiVersion))
    throw new ShopifyReadError("INVALID_API_VERSION", "Configura una versión estable de Shopify.");
  if (typeof fetchImpl !== "function")
    throw new ShopifyReadError("FETCH_UNAVAILABLE", "No está disponible la conexión HTTP.");
  const getToken = typeof tokenProvider === "function" ? tokenProvider : async () => token;
  const endpoint = "https://" + canonicalDomain + "/admin/api/" + apiVersion + "/graphql.json";
  let pendingThrottleMs = 0;
  async function wait(ms) {
    if (!Number.isFinite(ms) || ms > MAX_WAIT_MS)
      throw new ShopifyReadError("RATE_LIMITED", "Shopify solicita esperar antes de volver a leer.", { retryAfterSeconds: Math.ceil(ms / 1000) });
    if (ms > 0)
      await sleep(ms);
  }
  async function execute(query, variables) {
    if (!/^\s*query\b/.test(query) || /\bmutation\b/.test(query))
      throw new ShopifyReadError("READ_ONLY_REQUIRED", "Solo se admiten consultas de lectura.");
    let renewed = false;
    for (let attempt = 0;attempt < MAX_ATTEMPTS; attempt++) {
      await wait(pendingThrottleMs);
      pendingThrottleMs = 0;
      const secret = await getToken();
      if (typeof secret !== "string" || !secret.trim() || /[\s\x00-\x1f\x7f]/.test(secret))
        throw new ShopifyReadError("MISSING_CREDENTIAL", "Falta una credencial autorizada de Shopify.");
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": secret },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS2),
          redirect: "error"
        });
      } catch (error) {
        if (attempt < MAX_ATTEMPTS - 1) {
          await wait(retryDelay(null, attempt, now));
          continue;
        }
        const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";
        throw new ShopifyReadError(timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR", "No se pudo completar la conexión con Shopify.");
      }
      if (response.status === 401 && !renewed && getToken.canRenew && typeof getToken.invalidate === "function") {
        renewed = true;
        getToken.invalidate();
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt === MAX_ATTEMPTS - 1)
          throw new ShopifyReadError(response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR", "Shopify no pudo completar la lectura.", { status: response.status });
        await wait(retryDelay(response.headers?.get("Retry-After"), attempt, now));
        continue;
      }
      if (!response.ok)
        throw new ShopifyReadError(response.status === 401 || response.status === 403 ? "AUTHORIZATION_REQUIRED" : "HTTP_ERROR", "Shopify no autorizó o no pudo completar la lectura.", { status: response.status });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new ShopifyReadError("INVALID_RESPONSE", "Shopify no devolvió una respuesta válida.");
      }
      const throttle = payload.extensions?.cost?.throttleStatus;
      const requestedCost = Number(payload.extensions?.cost?.requestedQueryCost);
      const remaining = Number(throttle?.currentlyAvailable), restoreRate = Number(throttle?.restoreRate);
      if (Number.isFinite(requestedCost) && Number.isFinite(remaining) && restoreRate > 0)
        pendingThrottleMs = Math.max(0, Math.ceil((requestedCost - remaining) / restoreRate * 1000));
      if (Array.isArray(payload.errors) && payload.errors.length) {
        if (payload.errors.every((error) => error?.extensions?.code === "THROTTLED") && attempt < MAX_ATTEMPTS - 1) {
          if (!pendingThrottleMs)
            pendingThrottleMs = retryDelay(null, attempt, now);
          continue;
        }
        throw new ShopifyReadError(payload.errors.some((error) => error?.extensions?.code === "ACCESS_DENIED") ? "AUTHORIZATION_REQUIRED" : "GRAPHQL_ERROR", "Shopify rechazó una consulta de lectura. Revisa los permisos y la versión de API.");
      }
      if (!payload.data || typeof payload.data !== "object")
        throw new ShopifyReadError("INVALID_RESPONSE", "Shopify devolvió una respuesta sin datos.");
      return payload.data;
    }
    throw new ShopifyReadError("AUTHORIZATION_REQUIRED", "No se pudo renovar la autorización de Shopify.");
  }
  async function readConnection(query, key) {
    const nodes = [], ids = new Set, cursors = new Set;
    let after = null, shop;
    for (let page = 1;page <= MAX_PAGES; page++) {
      const data = await execute(query, { first: PAGE_SIZE, after });
      if (data.shop) {
        if (data.shop.myshopifyDomain?.toLowerCase() !== canonicalDomain)
          throw new ShopifyReadError("STORE_MISMATCH", "La lectura corresponde a una tienda distinta.");
        shop = data.shop;
      }
      const result = connection(data[key], key);
      for (const node of result.nodes) {
        if (typeof node?.id !== "string" || ids.has(node.id))
          throw new ShopifyReadError("DUPLICATE_RECORD", "Shopify devolvió identificadores ausentes o repetidos.");
        ids.add(node.id);
        nodes.push(node);
      }
      onProgress?.({ phase: key, pages: page, records: nodes.length, hasNextPage: result.pageInfo.hasNextPage });
      if (!result.pageInfo.hasNextPage)
        return { nodes, shop };
      if (cursors.has(result.pageInfo.endCursor))
        throw new ShopifyReadError("REPEATED_CURSOR", "Se recibió un cursor repetido.");
      cursors.add(result.pageInfo.endCursor);
      after = result.pageInfo.endCursor;
    }
    throw new ShopifyReadError("PAGINATION_LIMIT", "Se alcanzó el límite de páginas antes de completar la lectura.");
  }
  const locationResult = await readConnection(LOCATIONS_QUERY, "locations");
  if (!locationResult.shop)
    throw new ShopifyReadError("INVALID_RESPONSE", "La lectura no incluye la identidad de la tienda.");
  const variantResult = await readConnection(VARIANTS_QUERY, "productVariants");
  const warnings = [];
  for (const variant of variantResult.nodes) {
    const item = variant.inventoryItem;
    if (!item)
      throw new ShopifyReadError("INVALID_RESPONSE", "Faltan los datos de inventario de una variante.");
    let levels = connection(item.inventoryLevels, "inventoryLevels");
    const nodes = [...levels.nodes], seenLocations = new Set(nodes.map((level) => level.location?.id)), seenCursors = new Set;
    if (seenLocations.size !== nodes.length)
      throw new ShopifyReadError("DUPLICATE_RECORD", "Una ubicación de inventario está repetida.");
    for (let page = 1;levels.pageInfo.hasNextPage; page++) {
      if (page > MAX_PAGES || seenCursors.has(levels.pageInfo.endCursor))
        throw new ShopifyReadError("REPEATED_CURSOR", "No se pudo completar la paginación del inventario.");
      seenCursors.add(levels.pageInfo.endCursor);
      const data = await execute(INVENTORY_LEVELS_QUERY, { id: item.id, first: 100, after: levels.pageInfo.endCursor });
      if (data.inventoryItem?.id !== item.id)
        throw new ShopifyReadError("INVALID_RESPONSE", "El inventario de la página no corresponde a la variante.");
      levels = connection(data.inventoryItem.inventoryLevels, "inventoryLevels");
      for (const level of levels.nodes) {
        if (!level.location?.id || seenLocations.has(level.location.id))
          throw new ShopifyReadError("DUPLICATE_RECORD", "Una ubicación del inventario no es válida o está repetida.");
        seenLocations.add(level.location.id);
        nodes.push(level);
      }
    }
    item.inventoryLevels = { nodes, pageInfo: { hasNextPage: false, endCursor: levels.pageInfo.endCursor ?? null } };
    for (const [field, value, limit] of [["variantMedia", variant.media, 2], ["productMedia", variant.product?.media, 6]]) {
      if (value?.pageInfo?.hasNextPage)
        warnings.push({ code: "MEDIA_CONNECTION_TRUNCATED", variantId: variant.id, field, limit });
    }
  }
  return {
    shop: locationResult.shop,
    locations: locationResult.nodes,
    variants: variantResult.nodes,
    fetchedAt: new Date(now()).toISOString(),
    complete: true,
    issues: [],
    warnings,
    mediaComplete: warnings.length === 0,
    galleryLimitNotice: "La galería conserva hasta 2 medios por variante y 6 por producto; las cantidades de inventario se paginan completas.",
    source: "SHOPIFY_ADMIN_READ_ONLY",
    apiVersion,
    consistency: "PAGINATED_READ"
  };
}

// lib/shopifyRuntime.ts
var CANONICAL_DOMAIN = "1c76bc-08.myshopify.com";
var MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;
var LEDGER_LIMIT = 2000;
var LEDGER_AGE_MS = 24 * 60 * 60 * 1000;
var WEBHOOK_TOPICS = new Set([
  "inventory_levels/update",
  "inventory_levels/connect",
  "inventory_levels/disconnect",
  "inventory_items/update",
  "inventory_items/delete",
  "products/create",
  "products/update",
  "products/delete",
  "locations/create",
  "locations/update",
  "locations/delete",
  "locations/activate",
  "locations/deactivate"
]);
var SAFE_CODES = new Set([
  "INVALID_DOMAIN",
  "INVALID_CREDENTIAL",
  "INVALID_CONFIGURATION",
  "MISSING_CREDENTIAL",
  "AUTHORIZATION_REQUIRED",
  "MISSING_SCOPES",
  "SHOP_NOT_PERMITTED",
  "NETWORK_ERROR",
  "REQUEST_TIMEOUT",
  "HTTP_ERROR",
  "RATE_LIMITED",
  "INVALID_RESPONSE",
  "INVALID_CURSOR",
  "INVALID_API_VERSION",
  "DUPLICATE_RECORD",
  "REPEATED_CURSOR",
  "PAGINATION_LIMIT",
  "STORE_MISMATCH",
  "GRAPHQL_ERROR",
  "READ_ONLY_REQUIRED",
  "SERVER_ONLY_REQUIRED",
  "FETCH_UNAVAILABLE",
  "INCOMPLETE_SNAPSHOT"
]);
function inside(directory, file) {
  const relative = path.relative(directory, file);
  return relative === "" || !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}
function createShopifyInventoryRuntime({
  projectRoot,
  env = process.env,
  fetchImpl = globalThis.fetch,
  onInventory,
  now = Date.now,
  sleep,
  timers = { setInterval, clearInterval, setTimeout, clearTimeout }
}) {
  const root = path.resolve(projectRoot);
  const snapshotPath = path.resolve(root, env.BOLT_SHOPIFY_SNAPSHOT_PATH || ".bolt-private/shopify/snapshot.json");
  if (inside(path.join(root, "public"), snapshotPath) || inside(path.join(root, "dist"), snapshotPath) || inside(root, snapshotPath) && !inside(path.join(root, ".bolt-private"), snapshotPath)) {
    throw new Error("El inventario debe guardarse en una ruta privada del servidor.");
  }
  const ledgerPath = path.join(path.dirname(snapshotPath), "webhook-deliveries.json");
  const domain = (env.SHOPIFY_STORE_DOMAIN || CANONICAL_DOMAIN).trim().toLowerCase();
  const apiVersion = env.SHOPIFY_API_VERSION || "2026-10";
  const intervalInput = Number(env.SHOPIFY_SYNC_INTERVAL_MINUTES || 10);
  const intervalMinutes = Number.isFinite(intervalInput) && intervalInput >= 1 && intervalInput <= 1440 ? intervalInput : 10;
  const intervalMs = intervalMinutes * 60000;
  const credentialsConfigured = !!(env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim() || env.SHOPIFY_CLIENT_ID?.trim() && env.SHOPIFY_CLIENT_SECRET?.trim());
  const webhookSecret = env.SHOPIFY_WEBHOOK_SECRET || env.SHOPIFY_CLIENT_SECRET || "";
  let inventory = null;
  let initialized = false, running = false, liveVerified = false, syncing = false;
  let intervalHandle, webhookHandle;
  let lastSuccessfulSync, lastAttemptedSync, nextSyncAt;
  let errorCode = credentialsConfigured ? undefined : "MISSING_CREDENTIAL";
  let tokenProvider;
  let inFlight;
  let ledger = new Map;
  const stamp = () => new Date(now()).toISOString();
  function normalize(raw) {
    if (raw?.complete !== true || raw.shop?.myshopifyDomain?.toLowerCase() !== domain || raw.shop?.currencyCode !== "COP") {
      throw Object.assign(new Error("La lectura de inventario no es completa o no corresponde a esta tienda en COP."), { code: "INCOMPLETE_SNAPSHOT" });
    }
    const mapped = normalizeShopifySnapshot(raw);
    if (!mapped.status.complete)
      throw Object.assign(new Error("La lectura contiene páginas de inventario pendientes."), { code: "INCOMPLETE_SNAPSHOT" });
    return mapped;
  }
  function install(next) {
    const previousProducts = new Map(inventory?.products.map((product) => [product.shopifyVariantGid, product]) || []);
    for (const product of next.products) {
      const previous = previousProducts.get(product.shopifyVariantGid);
      if (previous)
        product.reservedStockByStore = { ...previous.reservedStockByStore };
    }
    const previousStores = new Map(inventory?.stores.map((store) => [store.id, store]) || []);
    for (const store of next.stores) {
      const previous = previousStores.get(store.id);
      if (previous?.verificationStatus === "VERIFIED" && previous.verifiedEntrance) {
        store.verifiedEntrance = { ...previous.verifiedEntrance };
        store.verificationStatus = previous.verificationStatus;
        store.verifiedAt = previous.verifiedAt;
        store.verifiedBy = previous.verifiedBy;
        store.placeId = previous.placeId;
      }
    }
    inventory = next;
    onInventory?.(next);
  }
  async function atomicWrite(raw) {
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    const temporaryPath = snapshotPath + ".tmp-" + randomUUID();
    try {
      await writeFile(temporaryPath, JSON.stringify(raw), { encoding: "utf8", mode: 384, flag: "wx" });
      await rename(temporaryPath, snapshotPath);
    } catch {
      await unlink(temporaryPath).catch(() => {
        return;
      });
      throw Object.assign(new Error("No se pudo guardar la lectura privada de inventario."), { code: "CACHE_WRITE_FAILED" });
    }
  }
  function pruneLedger() {
    const minimum = now() - LEDGER_AGE_MS;
    ledger = new Map([...ledger].filter(([, at]) => at >= minimum && at <= now()).slice(-LEDGER_LIMIT));
  }
  function getStatus() {
    const fetchedAt = inventory?.status.fetchedAt;
    const age = fetchedAt ? now() - Date.parse(fetchedAt) : Infinity;
    const authorizationMissing = ["MISSING_CREDENTIAL", "AUTHORIZATION_REQUIRED", "MISSING_SCOPES", "SHOP_NOT_PERMITTED", "INVALID_CREDENTIAL"].includes(errorCode || "");
    const isStale = !liveVerified || !Number.isFinite(age) || age > intervalMs * 2 || age < -60000 || authorizationMissing;
    let status;
    if (!credentialsConfigured)
      status = "PENDIENTE_AUTORIZACION";
    else if (syncing)
      status = "SINCRONIZANDO";
    else if (errorCode)
      status = authorizationMissing ? "PENDIENTE_AUTORIZACION" : "ERROR_SINCRONIZACION";
    else
      status = liveVerified && !isStale ? "CONECTADO" : "PENDIENTE_AUTORIZACION";
    return {
      mode: liveVerified ? "SHOPIFY_LIVE_READ_ONLY" : inventory ? "READ_ONLY_SNAPSHOT" : "UNCONFIGURED",
      status,
      automaticSync: running && credentialsConfigured,
      schedulerRunning: running && credentialsConfigured,
      liveVerified,
      isStale,
      credentialsConfigured,
      fetchedAt,
      lastSuccessfulSync,
      lastLiveReadAt: lastSuccessfulSync,
      lastAttemptedSync,
      nextSyncAt,
      reconciliationIntervalMinutes: intervalMinutes,
      errorCode,
      errorMessage: errorCode ? authorizationMissing ? "Falta autorizar la aplicación de Shopify con lectura de productos, inventario y ubicaciones." : "No se pudo actualizar el inventario. Se conserva la última lectura completa disponible." : undefined,
      storeDomain: /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(domain) ? domain : "",
      apiVersion: /^\d{4}-(?:01|04|07|10)$/.test(apiVersion) ? apiVersion : ""
    };
  }
  async function initialize() {
    if (initialized)
      return;
    initialized = true;
    try {
      install(normalize(JSON.parse(await readFile(snapshotPath, "utf8"))));
    } catch {
      if (credentialsConfigured)
        errorCode = "CACHE_UNAVAILABLE";
    }
    try {
      const entries = JSON.parse(await readFile(ledgerPath, "utf8"));
      if (Array.isArray(entries))
        ledger = new Map(entries.filter((entry) => Array.isArray(entry) && /^[A-Za-z0-9._:-]{1,200}$/.test(entry[0]) && Number.isFinite(entry[1])));
      pruneLedger();
    } catch {
      ledger = new Map;
    }
  }
  async function syncNow() {
    if (inFlight)
      return inFlight;
    if (!credentialsConfigured) {
      errorCode = "MISSING_CREDENTIAL";
      return getStatus();
    }
    syncing = true;
    lastAttemptedSync = stamp();
    const task = async () => {
      try {
        tokenProvider ||= createShopifyTokenProvider({ domain, clientId: env.SHOPIFY_CLIENT_ID, clientSecret: env.SHOPIFY_CLIENT_SECRET, accessToken: env.SHOPIFY_ADMIN_ACCESS_TOKEN, fetchImpl, now });
        const raw = await readShopifySnapshot({ domain, tokenProvider, apiVersion, fetchImpl, now, sleep });
        const next = normalize(raw);
        await atomicWrite(raw);
        install(next);
        lastSuccessfulSync = raw.fetchedAt;
        liveVerified = true;
        errorCode = undefined;
      } catch (error) {
        errorCode = SAFE_CODES.has(error?.code) || error?.code === "CACHE_WRITE_FAILED" ? error.code : "SYNC_FAILED";
      } finally {
        syncing = false;
      }
      return getStatus();
    };
    inFlight = task().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }
  function start() {
    if (running || !credentialsConfigured)
      return;
    running = true;
    nextSyncAt = new Date(now() + intervalMs).toISOString();
    syncNow();
    intervalHandle = timers.setInterval(() => {
      nextSyncAt = new Date(now() + intervalMs).toISOString();
      syncNow();
    }, intervalMs);
    intervalHandle?.unref?.();
  }
  function stop() {
    running = false;
    nextSyncAt = undefined;
    if (intervalHandle !== undefined)
      timers.clearInterval(intervalHandle);
    if (webhookHandle !== undefined)
      timers.clearTimeout(webhookHandle);
    intervalHandle = undefined;
    webhookHandle = undefined;
  }
  function acceptWebhook(rawBody, headers) {
    if (!running || !credentialsConfigured || !webhookSecret)
      return { accepted: false, status: 503 };
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > MAX_WEBHOOK_BYTES)
      return { accepted: false, status: 413 };
    const header = (name) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] || "";
    const signature = header("x-shopify-hmac-sha256");
    const id = header("x-shopify-webhook-id");
    if (header("x-shopify-shop-domain").toLowerCase() !== domain || !WEBHOOK_TOPICS.has(header("x-shopify-topic")) || !/^[A-Za-z0-9._:-]{1,200}$/.test(id) || !/^[A-Za-z0-9+/]{43}=$/.test(signature))
      return { accepted: false, status: 401 };
    const expected = createHmac("sha256", webhookSecret).update(rawBody).digest();
    const received = Buffer.from(signature, "base64");
    if (received.length !== expected.length || !timingSafeEqual(expected, received))
      return { accepted: false, status: 401 };
    try {
      const payload = JSON.parse(rawBody.toString("utf8"));
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return { accepted: false, status: 400 };
    } catch {
      return { accepted: false, status: 400 };
    }
    pruneLedger();
    if (ledger.has(id))
      return { accepted: true, status: 200, duplicate: true };
    const nextLedger = new Map([...ledger, [id, now()]].slice(-LEDGER_LIMIT));
    try {
      mkdirSync(path.dirname(ledgerPath), { recursive: true });
      const temporaryPath = ledgerPath + ".tmp-" + randomUUID();
      writeFileSync(temporaryPath, JSON.stringify([...nextLedger]), { mode: 384, flag: "wx" });
      renameSync(temporaryPath, ledgerPath);
      ledger = nextLedger;
    } catch {
      return { accepted: false, status: 503 };
    }
    if (webhookHandle === undefined) {
      webhookHandle = timers.setTimeout(() => {
        webhookHandle = undefined;
        if (running)
          syncNow();
      }, 1000);
      webhookHandle?.unref?.();
    }
    return { accepted: true, status: 200, duplicate: false };
  }
  return { initialize, getInventory: () => inventory, getStatus, start, stop, syncNow, acceptWebhook };
}

// src/lib/catalogAvailability.ts
function getCatalogAvailableQuantity(product, storeId) {
  const level = product.inventoryByStore?.[storeId];
  if (level?.available == null || !Number.isFinite(level.available))
    return 0;
  const available = product.stockByStore[storeId];
  const reserved = product.reservedStockByStore[storeId] ?? 0;
  if (!Number.isFinite(available) || !Number.isFinite(reserved) || reserved < 0)
    return 0;
  return Math.max(0, Math.floor(available - reserved));
}
function isCustomerCatalogProductVisible(product, storeId) {
  return (product.shopifyStatus || product.status) === "ACTIVE" && getCatalogAvailableQuantity(product, storeId) > 0;
}
function filterCustomerCatalog(products, storeId) {
  return storeId ? products.filter((product) => isCustomerCatalogProductVisible(product, storeId)) : [];
}

// src/lib/warehouseAssignment.ts
function assignScheduledWarehouse(quote, stores, products, items = []) {
  if (quote.assignedStoreId || !quote.scheduledEligible || !quote.destination?.coordinates)
    return quote;
  const byId = new Map(products.map((product) => [product.id, product]));
  const candidates = stores.filter((store) => store.isActive && !store.isPaused).map((store) => ({ store, distance: haversine(getStoreDispatchCoordinates(store), quote.destination.coordinates) })).filter((candidate) => candidate.distance <= DELIVERY_CONFIG.scheduledCoverageRadiusMeters).filter(({ store }) => items.every((item) => {
    const product = byId.get(item.productId);
    return product && Number.isSafeInteger(item.quantity) && item.quantity > 0 && getCatalogAvailableQuantity(product, store.id) >= item.quantity;
  })).sort((a, b) => a.distance - b.distance);
  const winner = candidates[0];
  if (!winner) {
    return {
      ...quote,
      eligibilityStatus: "INSUFFICIENT_STOCK",
      reasonCode: "NO_STOCK_WAREHOUSE",
      message: "Estamos revisando la disponibilidad para esta dirección. Conserva tu carrito y vuelve a consultar.",
      availableModes: { turbo: false, turboDividido: false, scheduled: false },
      recommendedMode: null,
      scheduledEligible: false,
      scheduledSlots: [],
      basketValidated: false
    };
  }
  return {
    ...quote,
    assignedStoreId: winner.store.id,
    assignedStoreName: winner.store.name,
    assignedStoreAddress: winner.store.address,
    assignedStoreCoordinates: getStoreDispatchCoordinates(winner.store)
  };
}

// server.ts
var __filename2 = fileURLToPath(import.meta.url);
var __dirname2 = path2.dirname(__filename2);
var stores = [];
var products = [];
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
      timestamp: Date.now() - 4000,
      sequenceNumber: 142
    }
  ]
};
async function startServer() {
  const inventoryRuntime = createShopifyInventoryRuntime({
    projectRoot: __dirname2,
    onInventory(inventory) {
      stores = inventory.stores;
      products = inventory.products;
      shopifyService.configureSnapshot(inventory);
    }
  });
  await inventoryRuntime.initialize();
  const inventoryStatus = () => {
    const state = inventoryRuntime.getStatus();
    const current = inventoryRuntime.getInventory();
    return {
      ...state,
      importedProductCount: current?.status.productsCount || 0,
      importedVariantCount: current?.products.length || 0,
      locationsCount: current?.status.locationsCount || 0,
      version: `${state.fetchedAt || "empty"}:${state.status}:${state.isStale}`
    };
  };
  const getShopifyState = () => ({ ...shopifyService.getState(), ...inventoryStatus() });
  const requireSyncAdmin = (req, res, next) => {
    const expected = process.env.BOLT_ADMIN_API_TOKEN;
    if (!expected)
      return res.status(503).json({ error: "Configura el acceso privado de administración en el servidor." });
    const provided = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
    const left = Buffer.from(provided), right = Buffer.from(expected);
    if (!left.length || left.length !== right.length || !timingSafeEqual2(left, right)) {
      return res.status(401).json({ error: "Esta operación requiere autorización de administración." });
    }
    next();
  };
  const quoteForInventory = (body) => assignScheduledWarehouse(evaluateDeliveryQuote(body, stores, products), stores, products, body.items);
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);
  app.use(cors());
  app.post("/api/v1/shopify/webhook", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => {
    const headers = Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
    const result = inventoryRuntime.acceptWebhook(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), headers);
    res.status(result.status).json({ received: result.accepted, duplicate: result.duplicate || false });
  });
  app.use(express.json({ limit: "15mb" }));
  app.use((req, res, next) => {
    let requestPath;
    try {
      requestPath = decodeURIComponent(req.path).replace(/\\/g, "/").toLowerCase();
    } catch {
      return res.sendStatus(400);
    }
    if (requestPath.includes("/.bolt-private") || requestPath.endsWith("/snapshot_36b24de9.json")) {
      return res.sendStatus(404);
    }
    next();
  });
  app.get("/api/v1/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "Bolt Pets Authoritative Backend",
      version: "1.0.0",
      timezone: "America/Bogota",
      locale: "es-CO",
      storesCount: stores.length,
      productsCount: products.length,
      inventoryMode: inventoryStatus().mode,
      inventoryFetchedAt: inventoryStatus().fetchedAt,
      shopifyProductCount: inventoryRuntime.getInventory()?.status.productsCount || 0,
      shopifyVariantCount: products.length,
      automaticSync: inventoryStatus().automaticSync,
      ordersCount: orders.length,
      timestamp: new Date().toISOString()
    });
  });
  app.get("/api/v1/stores", (_req, res) => {
    res.json(stores);
  });
  app.get("/api/v1/catalog", (req, res) => {
    const { category, species, storeId, q, scope } = req.query;
    let filtered;
    if (scope === "admin") {
      filtered = [...products];
    } else {
      if (typeof storeId !== "string" || !storeId)
        return res.status(400).json({ error: "Confirma tu dirección para consultar disponibilidad.", code: "ADDRESS_REQUIRED" });
      if (!stores.some((store) => store.id === storeId && store.isActive && !store.isPaused)) {
        return res.status(422).json({ error: "La bodega asignada no está disponible.", code: "WAREHOUSE_UNAVAILABLE" });
      }
      filtered = filterCustomerCatalog(products, storeId);
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Bolt-Inventory-Version", inventoryStatus().version);
    if (category && category !== "Todo") {
      filtered = filtered.filter((p) => p.category === category || p.pharmacySubcategory === category);
    }
    if (species && species !== "Todos") {
      filtered = filtered.filter((p) => p.species === species || p.species === "Ambos");
    }
    if (q) {
      const queryStr = String(q).toLowerCase();
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(queryStr) || p.brand.toLowerCase().includes(queryStr) || p.sku.toLowerCase().includes(queryStr) || p.presentation.toLowerCase().includes(queryStr) || p.activeIngredient && p.activeIngredient.toLowerCase().includes(queryStr) || p.tags.some((t) => t.toLowerCase().includes(queryStr)));
    }
    res.json(filtered);
  });
  app.post("/api/v1/delivery/quote", (req, res) => {
    try {
      return res.json(quoteForInventory(req.body));
    } catch {
      return res.status(400).json({ error: "Revisa la dirección y los productos del pedido." });
    }
  });
  app.get("/api/v1/inventory/status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(inventoryStatus());
  });
  app.get("/api/v1/geocode/reverse", async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: "Faltan parámetros lat y lng" });
    }
    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY || "AIzaSyBeZD10ABWRpSpwChGlSzPR-6wxdD9oJcE";
    try {
      const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}&language=es&region=co`);
      const data = await response.json();
      if (data.status === "OK" && data.results && data.results.length > 0) {
        const raw = data.results[0].formatted_address;
        let address = raw.replace(/,\s*Bogotá,\s*D\.C\.,\s*Bogotá,\s*Bogotá,\s*D\.C\./gi, ", Bogotá").replace(/,\s*Bogotá,\s*D\.C\./gi, ", Bogotá").replace(/,\s*Cundinamarca/gi, "").trim();
        return res.json({
          address,
          formattedAddress: address,
          rawAddress: raw,
          status: "OK"
        });
      } else {
        return res.status(404).json({ error: "No se encontraron resultados de dirección", status: data.status });
      }
    } catch (err) {
      console.error("Error en geocodificación inversa:", err);
      return res.status(500).json({ error: "Error del servidor al consultar geocodificación" });
    }
  });
  app.get("/api/v1/geocode/forward", async (req, res) => {
    const { address } = req.query;
    if (!address) {
      return res.status(400).json({ error: "Parámetro address requerido" });
    }
    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY || "AIzaSyBeZD10ABWRpSpwChGlSzPR-6wxdD9oJcE";
    try {
      const searchTarget = String(address).toLowerCase().includes("bogot") ? String(address) : `${address}, Bogotá, Colombia`;
      const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchTarget)}&key=${apiKey}&components=country:CO&language=es&region=co`);
      const data = await response.json();
      if (data.status === "OK" && data.results && data.results.length > 0) {
        const first = data.results[0];
        const location = first.geometry?.location;
        const raw = first.formatted_address;
        let formatted = raw.replace(/,\s*Bogotá,\s*D\.C\.,\s*Bogotá,\s*Bogotá,\s*D\.C\./gi, ", Bogotá").replace(/,\s*Bogotá,\s*D\.C\./gi, ", Bogotá").replace(/,\s*Cundinamarca/gi, "").trim();
        return res.json({
          coordinates: location ? { lat: Number(location.lat.toFixed(6)), lng: Number(location.lng.toFixed(6)) } : null,
          formattedAddress: formatted,
          status: "OK"
        });
      } else {
        return res.status(404).json({ error: "Dirección no encontrada", status: data.status });
      }
    } catch (err) {
      console.error("Error en geocodificación directa:", err);
      return res.status(500).json({ error: "Error al consultar geocodificación directa" });
    }
  });
  app.post("/api/v1/orders", (req, res) => {
    try {
      const {
        storeId,
        items,
        customer,
        deliveryAddress,
        paymentMethod,
        tip = 0,
        deliveryMode: requestedDeliveryMode,
        scheduledWindow
      } = req.body;
      if (!items || !items.length || !customer || !deliveryAddress || !paymentMethod) {
        return res.status(400).json({ error: "Faltan campos obligatorios para crear el pedido." });
      }
      if (inventoryStatus().isStale) {
        return res.status(409).json({ error: "Estamos actualizando la disponibilidad. Intenta nuevamente en unos momentos.", code: "INVENTORY_NOT_VERIFIED" });
      }
      if (!Array.isArray(items))
        return res.status(400).json({ error: "El pedido necesita una lista de productos válida." });
      const seenProducts = new Set;
      for (const item of items) {
        if (!item || !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || seenProducts.has(item.productId)) {
          return res.status(400).json({ error: "La cantidad del producto no es válida o está repetido." });
        }
        seenProducts.add(item.productId);
        const product = products.find((p) => p.id === item.productId);
        if (!product)
          return res.status(400).json({ error: "Un producto del pedido ya no está en el catálogo." });
        const blocked = getProductPurchaseBlock(product);
        if (blocked)
          return res.status(400).json({ error: `${product.name}: ${blocked}.`, code: "PRODUCT_DATA_PENDING" });
        Object.assign(item, {
          sku: product.sku,
          name: product.name,
          brand: product.brand,
          presentation: product.presentation,
          price: product.price,
          weightKg: product.weightKg,
          image: product.image,
          requiresPrescription: product.requiresPrescription
        });
      }
      let assignedStoreId = storeId;
      let evaluatedQuote = null;
      if (deliveryAddress.coordinates && !isNaN(deliveryAddress.coordinates.lat) && !isNaN(deliveryAddress.coordinates.lng)) {
        evaluatedQuote = quoteForInventory({
          destination: {
            address: deliveryAddress.address,
            details: deliveryAddress.details,
            coordinates: deliveryAddress.coordinates
          },
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity }))
        });
        if (requestedDeliveryMode === "PROGRAMADO") {
          if (!evaluatedQuote.scheduledEligible) {
            return res.status(400).json({
              error: evaluatedQuote.message || "Dirección fuera de la zona de cobertura metropolitana de entrega programada.",
              eligibilityStatus: evaluatedQuote.eligibilityStatus
            });
          }
          if (scheduledWindow) {
            const bookingVal = validateScheduledBooking(scheduledWindow);
            if (!bookingVal.valid) {
              return res.status(400).json({
                error: bookingVal.reason || "La franja de entrega programada seleccionada ya no está disponible.",
                code: "CUTOFF_EXPIRED"
              });
            }
            const currentSlotOrders = orders.filter((o) => o.deliveryMode === "PROGRAMADO" && o.scheduledWindow && o.scheduledWindow.date === scheduledWindow.date && (o.scheduledWindow.slotId === scheduledWindow.slotId || o.scheduledWindow.startTime === scheduledWindow.startTime));
            if (currentSlotOrders.length >= 10) {
              return res.status(400).json({
                error: "La franja seleccionada ha alcanzado su capacidad máxima. Por favor selecciona otro horario.",
                code: "SLOT_CAPACITY_EXCEEDED"
              });
            }
          }
        } else {
          if (evaluatedQuote.eligibilityStatus !== "ELIGIBLE") {
            return res.status(400).json({
              error: evaluatedQuote.message,
              eligibilityStatus: evaluatedQuote.eligibilityStatus,
              geographicDistanceMeters: evaluatedQuote.geographicDistanceMeters,
              roadDistanceMeters: evaluatedQuote.roadDistanceMeters
            });
          }
        }
        assignedStoreId = evaluatedQuote.assignedStoreId;
      }
      const assignedStore = stores.find((s) => s.id === assignedStoreId && s.isActive && !s.isPaused);
      if (!evaluatedQuote || !assignedStore)
        return res.status(400).json({ error: "Confirma tu dirección y la disponibilidad antes de realizar el pedido." });
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
      const totalWeightGrams = Math.round(totalWeightKg * 1000);
      const shipping = subtotal >= 70000 ? 0 : 4900;
      const serviceFee = 1500;
      const total = subtotal + shipping + serviceFee + tip;
      const random4DigitCode = Math.floor(1000 + Math.random() * 9000).toString();
      const newOrderNum = `#BP-${Math.floor(1000 + Math.random() * 9000)}`;
      let effectiveDeliveryMode = requestedDeliveryMode;
      if (!effectiveDeliveryMode) {
        if (totalWeightGrams > 60000 && evaluatedQuote?.turboDividido?.feasible) {
          effectiveDeliveryMode = "TURBO_DIVIDIDO";
        } else if (evaluatedQuote?.availableModes?.turbo) {
          effectiveDeliveryMode = "TURBO";
        } else {
          effectiveDeliveryMode = "PROGRAMADO";
        }
      }
      const isSplitOrder = effectiveDeliveryMode === "TURBO_DIVIDIDO";
      const estimatedMinutes = evaluatedQuote?.estimatedMinutes || (effectiveDeliveryMode === "PROGRAMADO" ? 180 : 25);
      const promiseEnd = effectiveDeliveryMode === "PROGRAMADO" && scheduledWindow ? `${scheduledWindow.date}T${scheduledWindow.endTime}:00.000Z` : new Date(Date.now() + estimatedMinutes * 60 * 1000).toISOString();
      const newOrderId = `ORD-2026-${Math.floor(1000 + Math.random() * 9000)}`;
      let childShipments = undefined;
      if (isSplitOrder && evaluatedQuote?.turboDividido?.shipments) {
        let accumulatedCash = 0;
        childShipments = evaluatedQuote.turboDividido.shipments.map((plan, idx) => {
          const assignedDriver = drivers[idx % drivers.length];
          const isLast = idx === evaluatedQuote.turboDividido.shipments.length - 1;
          let shipmentCash = 0;
          if (paymentMethod === "CASH_ON_DELIVERY") {
            if (isLast) {
              shipmentCash = Math.max(0, total - accumulatedCash);
            } else {
              const proportion = subtotal > 0 ? plan.subtotal / subtotal : 1 / evaluatedQuote.turboDividido.shipments.length;
              shipmentCash = Math.round(total * proportion);
              accumulatedCash += shipmentCash;
            }
          }
          const shipmentItems = plan.items.map((pi) => {
            const catalogItem = items.find((it) => it.productId === pi.productId);
            return {
              productId: pi.productId,
              sku: catalogItem?.sku || `SKU-${pi.productId}`,
              name: pi.name,
              brand: catalogItem?.brand || "Bolt Pets",
              presentation: catalogItem?.presentation || "",
              price: pi.price,
              quantity: pi.quantity,
              image: catalogItem?.image || "https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=800",
              weightKg: pi.unitWeightKg,
              requiresPrescription: !!catalogItem?.requiresPrescription,
              picked: false
            };
          });
          return {
            shipmentId: `SHP-${newOrderId.slice(-4)}-${idx + 1}`,
            shipmentIndex: idx + 1,
            shipmentCount: evaluatedQuote.turboDividido.shipments.length,
            parentOrderId: newOrderId,
            childOrderId: `${newOrderId}-${String.fromCharCode(65 + idx)}`,
            items: shipmentItems,
            weightKg: plan.weightKg,
            weightGrams: plan.weightGrams,
            subtotal: plan.subtotal,
            cashToCollect: shipmentCash,
            fulfillmentStatus: "CONFIRMADO",
            secretDeliveryCode: Math.floor(1000 + Math.random() * 9000).toString(),
            estimatedDeliveryMinutes: estimatedMinutes,
            driver: assignedDriver ? {
              id: assignedDriver.id,
              name: assignedDriver.name,
              phone: assignedDriver.phone,
              vehiclePlate: assignedDriver.vehiclePlate,
              vehicleType: assignedDriver.vehicleType,
              rating: assignedDriver.rating,
              photo: assignedDriver.photo
            } : undefined,
            timestamps: {
              confirmedAt: new Date().toISOString()
            }
          };
        });
      }
      const newOrder = {
        id: newOrderId,
        orderNumber: newOrderNum,
        createdAt: new Date().toISOString(),
        storeId: assignedStoreId,
        storeName: assignedStore.name,
        deliveryMode: effectiveDeliveryMode,
        scheduledWindow: effectiveDeliveryMode === "PROGRAMADO" ? scheduledWindow || evaluatedQuote?.scheduledSlots?.[0] : undefined,
        isSplitOrder,
        shipmentCount: childShipments ? childShipments.length : undefined,
        childShipments,
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
          transactionId: paymentMethod !== "CASH_ON_DELIVERY" ? `TXN-WMP-${Date.now().toString().slice(-7)}` : undefined
        },
        prescriptionReview: {
          status: hasPrescriptionItem ? "PENDIENTE_REVISION" : "NO_REQUIERE"
        },
        fulfillmentStatus: "CONFIRMADO",
        secretDeliveryCode: random4DigitCode,
        estimatedDeliveryMinutes: estimatedMinutes,
        originalPromiseWindow: {
          start: new Date().toISOString(),
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
        } : undefined,
        timestamps: {
          confirmedAt: new Date().toISOString()
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
    if (storeId)
      list = list.filter((o) => o.storeId === storeId);
    if (status)
      list = list.filter((o) => o.fulfillmentStatus === status);
    res.json(list);
  });
  app.get("/api/v1/orders/:orderId", (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order)
      return res.status(404).json({ error: "Pedido no encontrado" });
    res.json(order);
  });
  app.post("/api/v1/orders/:orderId/prescription", (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order)
      return res.status(404).json({ error: "Pedido no encontrado" });
    const { documentUrl, documentName, vetName, vetLicense } = req.body;
    order.prescriptionReview = {
      status: "PENDIENTE_REVISION",
      documentUrl,
      documentName,
      uploadedAt: new Date().toISOString(),
      vetName,
      vetLicense
    };
    res.json({ message: "Fórmula veterinaria enviada a revisión", order });
  });
  app.get("/api/v1/orders/:orderId/tracking", (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order)
      return res.status(404).json({ error: "Pedido no encontrado" });
    const history = gpsTelemetryHistory[order.id] || [];
    const latestTelemetry = history[history.length - 1];
    res.json({
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.fulfillmentStatus,
      deliveryMode: order.deliveryMode || "TURBO",
      scheduledWindow: order.scheduledWindow,
      isSplitOrder: !!order.isSplitOrder,
      shipmentCount: order.shipmentCount || (order.childShipments ? order.childShipments.length : 1),
      childShipments: order.childShipments,
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
        secondsAgo: Math.floor((Date.now() - latestTelemetry.timestamp) / 1000)
      } : null,
      hubCoordinates: stores.find((s) => s.id === order.storeId)?.coordinates || { lat: 4.6284, lng: -74.1539 },
      customerCoordinates: order.deliveryAddress.coordinates
    });
  });
  app.post("/api/v1/orders/:orderId/verify-delivery", (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order)
      return res.status(404).json({ error: "Pedido no encontrado" });
    const { deliveryCode, shipmentId } = req.body;
    const inputCode = String(deliveryCode).trim();
    if (order.isSplitOrder && order.childShipments && shipmentId) {
      const child = order.childShipments.find((s) => s.shipmentId === shipmentId);
      if (!child) {
        return res.status(404).json({ error: `Envío hijo no encontrado: ${shipmentId}` });
      }
      if (child.secretDeliveryCode !== inputCode && order.secretDeliveryCode !== inputCode) {
        return res.status(403).json({
          error: `Código de entrega inválido para el envío ${child.shipmentIndex} de ${child.shipmentCount}.`
        });
      }
      child.fulfillmentStatus = "ENTREGADO";
      child.timestamps.deliveredAt = new Date().toISOString();
      for (const item of child.items) {
        const prod = products.find((p) => p.id === item.productId);
        if (prod) {
          prod.stockByStore[order.storeId] = Math.max(0, (prod.stockByStore[order.storeId] || 0) - item.quantity);
          prod.reservedStockByStore[order.storeId] = Math.max(0, (prod.reservedStockByStore[order.storeId] || 0) - item.quantity);
        }
      }
      const allDelivered = order.childShipments.every((s) => s.fulfillmentStatus === "ENTREGADO");
      if (allDelivered) {
        order.fulfillmentStatus = "ENTREGADO";
        order.timestamps.deliveredAt = new Date().toISOString();
        if (order.payment.method === "CASH_ON_DELIVERY") {
          order.payment.cashSettled = true;
          order.payment.status = "APROBADO";
        }
      }
      return res.json({
        message: `Envío ${child.shipmentIndex} de ${child.shipmentCount} verificado y entregado exitosamente`,
        childShipment: child,
        order
      });
    }
    if (order.secretDeliveryCode !== inputCode) {
      return res.status(403).json({ error: "Código de entrega inválido. Verifique el número de 4 dígitos con el cliente." });
    }
    order.fulfillmentStatus = "ENTREGADO";
    order.timestamps.deliveredAt = new Date().toISOString();
    if (order.childShipments) {
      order.childShipments.forEach((s) => {
        s.fulfillmentStatus = "ENTREGADO";
        s.timestamps.deliveredAt = new Date().toISOString();
      });
    }
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
      return res.status(400).json({ error: "Datos de telemetría incompletos" });
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
        updatedAt: new Date().toISOString()
      };
    }
    res.json({ status: "telemetry_received", count: gpsTelemetryHistory[telemetry.orderId].length });
  });
  app.post("/api/v1/operations/orders/:orderId/status", (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order)
      return res.status(404).json({ error: "Pedido no encontrado" });
    const { status, shipmentId } = req.body;
    if (order.isSplitOrder && order.childShipments && shipmentId) {
      const child = order.childShipments.find((s) => s.shipmentId === shipmentId);
      if (child) {
        child.fulfillmentStatus = status;
        const nowIso = new Date().toISOString();
        if (status === "EN_ALISTAMIENTO" && !child.timestamps.prepStartedAt)
          child.timestamps.prepStartedAt = nowIso;
        if (status === "LISTO_PARA_DESPACHO" && !child.timestamps.prepCompletedAt)
          child.timestamps.prepCompletedAt = nowIso;
        if (status === "EN_CAMINO" && !child.timestamps.pickedUpAt)
          child.timestamps.pickedUpAt = nowIso;
        if (status === "ENTREGADO" && !child.timestamps.deliveredAt)
          child.timestamps.deliveredAt = nowIso;
        if (order.childShipments.every((s) => s.fulfillmentStatus === "ENTREGADO")) {
          order.fulfillmentStatus = "ENTREGADO";
          order.timestamps.deliveredAt = nowIso;
        } else if (order.childShipments.some((s) => s.fulfillmentStatus === "EN_CAMINO")) {
          order.fulfillmentStatus = "EN_CAMINO";
        } else if (order.childShipments.some((s) => s.fulfillmentStatus === "REPARTIDOR_ASIGNADO")) {
          order.fulfillmentStatus = "REPARTIDOR_ASIGNADO";
        } else if (order.childShipments.some((s) => s.fulfillmentStatus === "LISTO_PARA_DESPACHO")) {
          order.fulfillmentStatus = "LISTO_PARA_DESPACHO";
        } else if (order.childShipments.some((s) => s.fulfillmentStatus === "EN_ALISTAMIENTO")) {
          order.fulfillmentStatus = "EN_ALISTAMIENTO";
        }
        return res.json({ message: `Estado del envío ${child.shipmentIndex} actualizado a ${status}`, child, order });
      }
    }
    order.fulfillmentStatus = status;
    if (status === "EN_ALISTAMIENTO" && !order.timestamps.prepStartedAt) {
      order.timestamps.prepStartedAt = new Date().toISOString();
    }
    if (status === "LISTO_PARA_DESPACHO" && !order.timestamps.prepCompletedAt) {
      order.timestamps.prepCompletedAt = new Date().toISOString();
    }
    if (status === "EN_CAMINO" && !order.timestamps.pickedUpAt) {
      order.timestamps.pickedUpAt = new Date().toISOString();
    }
    res.json({ message: "Estado actualizado", order });
  });
  app.post("/api/v1/operations/orders/:orderId/prescription/review", (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order)
      return res.status(404).json({ error: "Pedido no encontrado" });
    const { status, reviewNotes, reviewerName } = req.body;
    order.prescriptionReview = {
      ...order.prescriptionReview,
      status,
      reviewNotes,
      reviewedBy: reviewerName || "Dra. Sandra Peña (Química Farmacéutica Veterinaria)",
      reviewedAt: new Date().toISOString()
    };
    res.json({ message: "Revisión farmacéutica registrada", order });
  });
  app.post("/api/v1/operations/orders/:orderId/assign-driver", (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order)
      return res.status(404).json({ error: "Pedido no encontrado" });
    const { driverId, shipmentId } = req.body;
    const driver = drivers.find((d) => d.id === driverId) || drivers[0];
    const driverPayload = {
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      vehiclePlate: driver.vehiclePlate,
      vehicleType: driver.vehicleType,
      rating: driver.rating,
      photo: driver.photo
    };
    if (order.isSplitOrder && order.childShipments && shipmentId) {
      const child = order.childShipments.find((s) => s.shipmentId === shipmentId);
      if (child) {
        child.driver = driverPayload;
        child.fulfillmentStatus = "REPARTIDOR_ASIGNADO";
        child.timestamps.assignedAt = new Date().toISOString();
        if (order.childShipments.every((s) => !!s.driver)) {
          order.fulfillmentStatus = "REPARTIDOR_ASIGNADO";
          order.timestamps.assignedAt = new Date().toISOString();
        }
        return res.json({ message: `Conductor asignado al envío ${child.shipmentIndex}`, child, order });
      }
    }
    order.driver = driverPayload;
    order.fulfillmentStatus = "REPARTIDOR_ASIGNADO";
    order.timestamps.assignedAt = new Date().toISOString();
    res.json({ message: "Conductor asignado exitosamente", order });
  });
  app.get("/api/v1/integrations/status", (_req, res) => {
    res.json({
      shopifyOlfato: {
        name: "Shopify / Olfato",
        status: inventoryStatus().status === "CONECTADO" ? "Conectado · lectura de inventario" : "Lectura guardada · conexión pendiente o desactualizada",
        lastSync: inventoryStatus().lastSuccessfulSync || inventoryStatus().fetchedAt,
        mappedSkusCount: products.length,
        automaticSync: inventoryStatus().automaticSync
      },
      siigoNube: {
        name: "Siigo Nube (Facturación Electrónica DIAN)",
        status: "En pruebas",
        lastSync: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        pendingInvoices: 2
      },
      wompi: {
        name: "Wompi Colombia (Bancolombia, Tarjetas, PSE)",
        status: "Conectada (Ambiente Sandbox)",
        lastTransaction: new Date(Date.now() - 12 * 60 * 1000).toISOString()
      },
      whatsappBot: {
        name: "WhatsApp Business API Bot",
        status: "Conectada (Simulador Activo)",
        activeConversations: 3
      }
    });
  });
  app.post("/api/v1/stores/:id/verify-entrance", (req, res) => {
    const store = stores.find((s) => s.id === req.params.id);
    if (!store)
      return res.status(404).json({ error: "Bodega no encontrada" });
    const { coordinates, verifiedBy = "Administrador Logística Bolt" } = req.body;
    if (!coordinates || typeof coordinates.lat !== "number" || typeof coordinates.lng !== "number") {
      return res.status(400).json({ error: "Coordenadas de entrada inválidas" });
    }
    const verifiedCoords = {
      lat: Number(coordinates.lat.toFixed(6)),
      lng: Number(coordinates.lng.toFixed(6))
    };
    store.verifiedEntrance = verifiedCoords;
    store.coordinates = verifiedCoords;
    store.verificationStatus = "VERIFIED";
    store.verifiedAt = new Date().toISOString();
    store.verifiedBy = verifiedBy;
    res.json({
      message: `Entrada física de cargue verificada para ${store.name}`,
      store
    });
  });
  app.get("/api/v1/shopify/status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(getShopifyState());
  });
  app.post("/api/v1/shopify/sync", requireSyncAdmin, async (_req, res) => {
    try {
      await inventoryRuntime.syncNow();
      const state = getShopifyState();
      res.status(state.status === "CONECTADO" ? 200 : 503).json({
        message: state.status === "CONECTADO" ? "Lectura real de Shopify completada." : state.errorMessage || "La conexión de Shopify requiere autorización.",
        state
      });
    } catch (e) {
      res.status(500).json({ error: e.message || "Error en conciliación de inventario con Shopify" });
    }
  });
  app.post("/api/v1/shopify/simulate-webhook", requireSyncAdmin, (req, res) => {
    const { storeId, sku, newOnHand, committed = 0 } = req.body;
    if (!storeId || !sku || typeof newOnHand !== "number") {
      return res.status(400).json({ error: "Faltan parámetros requeridos (storeId, sku, newOnHand)" });
    }
    const result = shopifyService.updateLocationStock(storeId, sku, newOnHand, committed);
    if (!result.success) {
      return res.status(404).json({ error: result.error || "No se pudo actualizar el inventario" });
    }
    const prod = products.find((p) => p.sku === sku);
    if (prod) {
      prod.stockByStore[storeId] = Math.max(0, newOnHand - committed);
    }
    res.json({
      message: `Webhook simulado exitosamente: Stock actualizado en ${storeId} para SKU ${sku}`,
      item: result.item,
      state: shopifyService.getState()
    });
  });
  if (true) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.bolt-private/**"] }
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }
  inventoryRuntime.start();
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Bolt Pets Authoritative Full-Stack Server running on port ${PORT}`);
  });
  const shutdown = () => {
    inventoryRuntime.stop();
    server.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
