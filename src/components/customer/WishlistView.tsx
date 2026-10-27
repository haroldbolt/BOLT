import React, { useState } from 'react';
import { 
  Bookmark, Plus, ShoppingBag, Trash2, Edit2, Check, 
  Sparkles, ArrowRight, Package, AlertCircle, Heart, FolderPlus, 
  Clock, ShieldCheck, Zap, X
} from 'lucide-react';
import { Product, WishlistCollection, WishlistItem } from '../../types';
import { formatCOP } from '../../lib/formatters';

interface WishlistViewProps {
  collections: WishlistCollection[];
  products: Product[];
  selectedStoreId: string;
  cartQuantities: Record<string, number>;
  onAddToCart: (product: Product, quantity?: number) => void;
  onAddCollectionToCart: (collectionId: string) => void;
  onRemoveItemFromCollection: (collectionId: string, productId: string) => void;
  onUpdateItemNote: (collectionId: string, productId: string, notes: string) => void;
  onCreateCollection: (name: string, icon?: string) => void;
  onDeleteCollection: (collectionId: string) => void;
  onOpenProductDetails: (product: Product) => void;
  onNavigateToCatalog: () => void;
}

export const WishlistView: React.FC<WishlistViewProps> = ({
  collections,
  products,
  selectedStoreId,
  cartQuantities,
  onAddToCart,
  onAddCollectionToCart,
  onRemoveItemFromCollection,
  onUpdateItemNote,
  onCreateCollection,
  onDeleteCollection,
  onOpenProductDetails,
  onNavigateToCatalog,
}) => {
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>(
    collections[0]?.id || ''
  );
  const [editingNoteProductId, setEditingNoteProductId] = useState<string | null>(null);
  const [tempNoteText, setTempNoteText] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionEmoji, setNewCollectionEmoji] = useState('🐶');

  // Keep selected collection synced
  const activeCollection = collections.find(c => c.id === selectedCollectionId) || collections[0];

  // Map collection items to actual Product objects with stock status
  const collectionProducts = (activeCollection?.items || []).map(item => {
    const prod = products.find(p => p.id === item.productId);
    return {
      item,
      product: prod,
    };
  }).filter(entry => entry.product !== undefined) as { item: WishlistItem; product: Product }[];

  // Calculate estimated subtotal of all available products in this collection
  const collectionSubtotal = collectionProducts.reduce((acc, entry) => {
    return acc + (entry.product.price * (entry.item.desiredQuantity || 1));
  }, 0);

  const handleStartEditNote = (productId: string, currentNote?: string) => {
    setEditingNoteProductId(productId);
    setTempNoteText(currentNote || '');
  };

  const handleSaveNote = (productId: string) => {
    if (!activeCollection) return;
    onUpdateItemNote(activeCollection.id, productId, tempNoteText.trim());
    setEditingNoteProductId(null);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim()) return;
    onCreateCollection(newCollectionName.trim(), newCollectionEmoji);
    setNewCollectionName('');
    setShowCreateModal(false);
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in">
      {/* 1. Header Banner */}
      <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-red-600 rounded-3xl p-5 sm:p-6 text-white shadow-lg relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 opacity-10 flex items-center pointer-events-none pr-6">
          <Bookmark className="w-48 h-48 fill-white" />
        </div>

        <div className="relative z-10 max-w-xl space-y-2">
          <div className="inline-flex items-center gap-1.5 bg-black/20 backdrop-blur-xs px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider text-yellow-200">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Listas de Deseos Personalizadas</span>
          </div>

          <h2 className="text-xl sm:text-2xl font-black tracking-tight leading-tight">
            Planifica tus compras y repite pedidos sin esfuerzo
          </h2>
          <p className="text-xs sm:text-sm text-white/90 leading-relaxed font-medium">
            Agrupa productos en colecciones temáticas (comida mensual, farmacia, premios), añade notas de cuidado y transfiérelos todos al carrito con un solo toque.
          </p>
        </div>
      </div>

      {/* 2. Collection Tabs / Selector + New Collection Button */}
      <div className="flex items-center justify-between gap-3 overflow-x-auto pb-1 no-scrollbar">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
          {collections.map(col => {
            const isSelected = col.id === activeCollection?.id;
            return (
              <button
                key={col.id}
                onClick={() => setSelectedCollectionId(col.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold whitespace-nowrap transition-all shadow-2xs ${
                  isSelected
                    ? 'bg-slate-900 text-white shadow-md scale-[1.02]'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                <span>{col.icon || '📦'}</span>
                <span>{col.name}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
                    isSelected ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {col.items.length}
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="shrink-0 flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-700 font-extrabold text-xs px-3.5 py-2.5 rounded-2xl border border-red-200 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Nueva lista</span>
        </button>
      </div>

      {/* 3. Active Collection Dashboard Banner */}
      {activeCollection ? (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-2xl flex items-center justify-center shrink-0 shadow-xs">
                {activeCollection.icon || '📦'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-black text-slate-900 text-base sm:text-lg">
                    {activeCollection.name}
                  </h3>
                  {collections.length > 1 && (
                    <button
                      onClick={() => onDeleteCollection(activeCollection.id)}
                      className="text-slate-400 hover:text-red-600 p-1 transition"
                      title="Eliminar esta colección"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 font-medium">
                  {collectionProducts.length} {collectionProducts.length === 1 ? 'producto' : 'productos'} guardados • Subtotal estimado: <strong className="text-slate-900">{formatCOP(collectionSubtotal)}</strong>
                </p>
              </div>
            </div>

            {/* Massive Action CTA: Mover toda la colección al carrito */}
            <div className="w-full md:w-auto flex items-center gap-2">
              <button
                onClick={() => onAddCollectionToCart(activeCollection.id)}
                disabled={collectionProducts.length === 0}
                className="w-full md:w-auto px-5 py-3 rounded-2xl bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-black text-xs sm:text-sm shadow-md transition-all active:scale-95 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4 fill-white" />
                <span>Mover toda la colección al carrito</span>
              </button>
            </div>
          </div>

          {/* 4. Products Grid in Active Collection */}
          {collectionProducts.length === 0 ? (
            <div className="bg-white rounded-3xl p-8 border border-dashed border-slate-200 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
                <Package className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-black text-slate-800 text-sm">
                  Esta colección está vacía
                </h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 font-medium">
                  Guarda productos haciendo clic en el marcador de lista en cualquier tarjeta para organizar tu próxima compra.
                </p>
              </div>
              <button
                onClick={onNavigateToCatalog}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs transition"
              >
                <span>Explorar catálogo Bolt Pets</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {collectionProducts.map(({ item, product }) => {
                const isOutOfStock = (product.stockByStore[selectedStoreId] || 0) <= 0;
                const inCartCount = cartQuantities[product.id] || 0;
                const isEditingNote = editingNoteProductId === product.id;

                return (
                  <div
                    key={product.id}
                    className="bg-white rounded-3xl p-3.5 border border-slate-100 shadow-xs flex flex-col justify-between hover:shadow-md transition relative group"
                  >
                    <div>
                      {/* Product Basic Row */}
                      <div className="flex gap-3">
                        <img
                          src={product.image}
                          alt={product.name}
                          onClick={() => onOpenProductDetails(product)}
                          className="w-16 h-16 object-cover rounded-2xl border border-slate-100 bg-white p-1 cursor-pointer shrink-0 hover:opacity-90 transition"
                        />

                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 block truncate">
                            {product.brand}
                          </span>
                          <h4
                            onClick={() => onOpenProductDetails(product)}
                            className="font-bold text-xs text-slate-900 hover:text-red-600 cursor-pointer line-clamp-2 leading-snug"
                          >
                            {product.name}
                          </h4>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="font-extrabold text-xs text-slate-900">
                              {formatCOP(product.price)}
                            </span>
                            {product.presentation && (
                              <span className="text-[10px] text-slate-400">
                                • {product.presentation}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Remove from collection button */}
                        <button
                          onClick={() => onRemoveItemFromCollection(activeCollection.id, product.id)}
                          className="text-slate-300 hover:text-rose-600 p-1 transition shrink-0"
                          title="Remover de esta colección"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Customized Note per Item */}
                      <div className="mt-3 p-2.5 rounded-2xl bg-amber-50/70 border border-amber-200/80 text-xs">
                        {isEditingNote ? (
                          <div className="space-y-1.5">
                            <textarea
                              value={tempNoteText}
                              onChange={(e) => setTempNoteText(e.target.value)}
                              placeholder="Escribe una nota (ej: Comprar sabor salmón, dosis cada 15 días)..."
                              rows={2}
                              autoFocus
                              className="w-full text-[11px] p-2 bg-white border border-amber-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-amber-500 font-medium"
                            />
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setEditingNoteProductId(null)}
                                className="px-2 py-0.5 text-[10px] font-bold text-slate-500 hover:text-slate-700"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={() => handleSaveNote(product.id)}
                                className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black rounded-lg shadow-xs flex items-center gap-1"
                              >
                                <Check className="w-3 h-3" />
                                <span>Guardar nota</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            onClick={() => handleStartEditNote(product.id, item.notes)}
                            className="cursor-pointer group/note flex items-start justify-between gap-1 text-[11px]"
                          >
                            <div className="flex-1">
                              {item.notes ? (
                                <p className="text-amber-950 font-medium leading-relaxed italic">
                                  "{item.notes}"
                                </p>
                              ) : (
                                <span className="text-amber-700/80 font-semibold flex items-center gap-1">
                                  <Edit2 className="w-3 h-3 text-amber-600" />
                                  <span>+ Añadir nota para este producto...</span>
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-amber-700 opacity-60 group-hover/note:opacity-100 transition shrink-0 font-bold ml-1">
                              Editar
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bottom Actions Row */}
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                      <div className="text-[10px]">
                        {isOutOfStock ? (
                          <span className="text-rose-600 font-bold">Agotado en sede</span>
                        ) : (
                          <span className="text-emerald-700 font-bold">✓ Disponible Turbo 25 min</span>
                        )}
                      </div>

                      <button
                        onClick={() => onAddToCart(product)}
                        disabled={isOutOfStock}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-extrabold text-[11px] rounded-xl shadow-xs transition flex items-center gap-1.5 active:scale-95"
                      >
                        <ShoppingBag className="w-3.5 h-3.5" />
                        <span>{inCartCount > 0 ? `En carrito (${inCartCount})` : 'Agregar al carrito'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-3xl p-8 border border-slate-200 text-center space-y-3">
          <p className="text-sm font-bold text-slate-600">No tienes colecciones creadas todavía.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-red-600 text-white font-bold text-xs rounded-xl shadow-xs"
          >
            Crear mi primera colección
          </button>
        </div>
      )}

      {/* Create New Collection Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h4 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-red-600" />
                Nueva Colección
              </h4>
              <button
                onClick={() => setShowCreateModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Nombre de la colección
                </label>
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="Ej: Dieta blanda Max, Antipulgas cada mes..."
                  autoFocus
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-red-500 font-medium"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Icono temático
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {['🐶', '🐱', '🍖', '💊', '🎾', '📦', '⭐', '❤️', '🩺', '✨'].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setNewCollectionEmoji(emoji)}
                      className={`w-8 h-8 rounded-xl text-base flex items-center justify-center transition ${
                        newCollectionEmoji === emoji
                          ? 'bg-red-600 text-white scale-110 shadow-xs'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!newCollectionName.trim()}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-black text-xs rounded-xl shadow-xs transition"
                >
                  Crear colección
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
