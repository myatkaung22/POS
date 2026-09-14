import { useEffect, useState } from "react";
import { api } from "../api";
import type { Category, MenuItem } from "../types";
import { toast } from "../components/Toast";
import { money } from "../types";
import { useAuth } from "../auth";
import { DishPhoto } from "../components/DishPhoto";

const emptyItem = {
  name: "",
  description: "",
  price: 0,
  emoji: "🍽️",
  sku: "",
  available: true,
  kitchenPrint: true,
  categoryId: "",
  imageUrl: "",
};

export function MenuPage() {
  const { settings } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [catName, setCatName] = useState("");
  const [form, setForm] = useState(emptyItem);
  const [editing, setEditing] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [removeImage, setRemoveImage] = useState(false);

  async function load() {
    setCategories(await api<Category[]>("/api/menu/admin"));
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  function resetForm(categoryId = form.categoryId) {
    if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setForm({ ...emptyItem, categoryId });
    setEditing(null);
    setImageFile(null);
    setImagePreview("");
    setRemoveImage(false);
  }

  async function saveItem() {
    if (!form.name || !form.categoryId) return toast("Name and category required", "err");
    const data = new FormData();
    data.append("categoryId", form.categoryId);
    data.append("name", form.name);
    data.append("description", form.description);
    data.append("price", String(form.price));
    data.append("emoji", form.emoji || "🍽️");
    data.append("sku", form.sku);
    data.append("available", String(form.available));
    data.append("kitchenPrint", String(form.kitchenPrint));
    if (imageFile) data.append("image", imageFile);
    if (removeImage) data.append("removeImage", "true");
    try {
      if (editing) {
        await api(`/api/menu-items/${editing}`, { method: "PATCH", body: data });
        toast("Item updated");
      } else {
        await api("/api/menu-items", { method: "POST", body: data });
        toast("Item created");
      }
      resetForm();
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "err");
    }
  }

  const previewItem = {
    name: form.name || "Menu photo",
    emoji: form.emoji,
    imageUrl: removeImage ? "" : imagePreview || form.imageUrl,
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <div className="space-y-4">
        <div className="rounded-[28px] border border-white/10 bg-ink-900 p-5">
          <div className="display text-xl">Category</div>
          <div className="mt-3 flex gap-2">
            <input
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              className="flex-1 rounded-2xl bg-ink-800 px-3 py-2"
              placeholder="New category"
            />
            <button
              onClick={async () => {
                if (!catName.trim()) return;
                await api("/api/categories", { method: "POST", body: JSON.stringify({ name: catName.trim() }) });
                setCatName("");
                void load();
              }}
              className="rounded-2xl bg-gold-500 px-4 text-ink-950"
            >
              Add
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-2xl bg-ink-800 px-3 py-2 text-sm">
                {c.name}
                <button
                  onClick={async () => {
                    await api(`/api/categories/${c.id}`, { method: "DELETE" });
                    if (form.categoryId === c.id) resetForm("");
                    void load();
                  }}
                  className="text-rose-400"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-[28px] border border-white/10 bg-ink-900 p-5">
          <div className="display text-xl">{editing ? "Edit item" : "New item"}</div>
          <p className="mt-1 text-xs text-cream-100/45">Add a photo for POS and the guest QR menu. JPG, PNG, or WEBP, up to 5 MB.</p>
          <div className="mt-3 space-y-2">
            <select
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              className="w-full rounded-2xl bg-ink-800 px-3 py-2"
            >
              <option value="">Category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input className="w-full rounded-2xl bg-ink-800 px-3 py-2" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="w-full rounded-2xl bg-ink-800 px-3 py-2" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="grid grid-cols-3 gap-2">
              <input className="rounded-2xl bg-ink-800 px-3 py-2" placeholder="Emoji" value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} />
              <input className="rounded-2xl bg-ink-800 px-3 py-2" placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
              <input type="number" className="rounded-2xl bg-ink-800 px-3 py-2" placeholder="Price (฿)" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
            </div>
            <div className="rounded-2xl bg-ink-800 p-3">
              <DishPhoto item={previewItem} className="h-36 w-full rounded-xl" />
              <label className="mt-3 block cursor-pointer rounded-xl bg-white/5 px-3 py-2 text-center text-sm">
                {imageFile ? imageFile.name : "Choose image"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                    setImageFile(file);
                    setRemoveImage(false);
                    setImagePreview(file ? URL.createObjectURL(file) : "");
                  }}
                />
              </label>
              {(form.imageUrl || imageFile) && !removeImage && (
                <button
                  type="button"
                  onClick={() => {
                    if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                    setImageFile(null);
                    setImagePreview("");
                    setRemoveImage(true);
                  }}
                  className="mt-2 w-full rounded-xl bg-white/5 py-2 text-sm text-rose-400"
                >
                  Remove image
                </button>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.available} onChange={(e) => setForm({ ...form, available: e.target.checked })} /> Available
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.kitchenPrint} onChange={(e) => setForm({ ...form, kitchenPrint: e.target.checked })} /> Print on kitchen slip
            </label>
            <button onClick={() => void saveItem()} className="w-full rounded-2xl bg-gold-500 py-2 text-ink-950">
              {editing ? "Save changes" : "Add item"}
            </button>
            {editing && (
              <button onClick={() => resetForm()} className="w-full rounded-2xl bg-white/5 py-2 text-sm">
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="rounded-[28px] border border-white/10 bg-ink-900 p-5">
        {categories.map((c) => (
          <div key={c.id} className="mb-6">
            <div className="display text-2xl text-gold-400">{c.name}</div>
            <div className="mt-3 divide-y divide-white/5">
              {c.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  currency={settings.currency}
                  onEdit={() => {
                    if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                    setEditing(item.id);
                    setForm({
                      name: item.name,
                      description: item.description,
                      price: item.price,
                      emoji: item.emoji,
                      sku: item.sku,
                      available: item.available,
                      kitchenPrint: item.kitchenPrint,
                      categoryId: item.categoryId,
                      imageUrl: item.imageUrl || "",
                    });
                    setImageFile(null);
                    setImagePreview("");
                    setRemoveImage(false);
                  }}
                  onDelete={async () => {
                    await api(`/api/menu-items/${item.id}`, { method: "DELETE" });
                    if (editing === item.id) resetForm();
                    toast("Item deleted");
                    void load();
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  currency,
  onEdit,
  onDelete,
}: {
  item: MenuItem;
  currency?: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <DishPhoto item={item} className="h-14 w-14 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{item.name}</div>
          <div className="text-xs text-cream-100/50">{item.description}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="text-gold-400">{money(item.price, currency)}</div>
        <button onClick={onEdit} className="rounded-xl bg-white/5 px-3 py-1 text-sm">
          Edit
        </button>
        <button onClick={onDelete} className="rounded-xl bg-white/5 px-3 py-1 text-sm text-rose-400">
          Delete
        </button>
      </div>
    </div>
  );
}
