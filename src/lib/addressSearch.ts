import type {AddressTerritory} from './addressGeography';

export interface AddressSearchCandidate extends AddressTerritory {
  placeId: string;
  formattedAddress: string;
  coordinates: {lat:number;lng:number};
}
export interface AddressSearchResult {
  status: 'SELECT_ADDRESS' | 'MUNICIPALITY_REQUIRED' | 'MUNICIPALITY_MISMATCH' | 'NO_RESULTS' | 'UNAVAILABLE';
  candidates: AddressSearchCandidate[];
  message: string;
}
