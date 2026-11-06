import React from 'react';
import type { Order, Store } from '../../types';
import { resolveOrderWarehouse } from '../../lib/warehouseAssignment';

export const WarehouseSummary = ({order,store,proposed=false}:{order?:Order;store?:Store;proposed?:boolean}) => {
 const warehouse=order ? resolveOrderWarehouse(order) : store ? {name:store.name,customerName:store.customerName || store.name,address:store.showAddressToCustomer===false?undefined:store.address} : undefined;
 return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700" data-testid="warehouse-summary">
   <p className="font-bold">{warehouse ? `${proposed?'Sede propuesta':'Sede de preparación y despacho'}: ${warehouse.customerName}` : 'Sede pendiente de confirmar'}</p>
   {warehouse?.address && <p className="mt-1 text-slate-500">{warehouse.address}</p>}
 </div>;
};
