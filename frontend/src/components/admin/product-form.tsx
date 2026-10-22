import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  ImagePlus,
  Info,
  Loader2,
  Save,
  Store,
  Trash2,
  Upload,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { ProductThumb } from "@/components/admin/product-thumb";
import { ProductGalleryEditor } from "@/components/admin/product-gallery-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useCreateProduct, useUpdateProduct } from "@/features/admin/mutations";
import {
  productFormDefaults,
  productFormSchema,
  type ProductFormValues,
} from "@/features/admin/product-form-schema";
import { uploadProductImage, validateImageFile } from "@/features/admin/upload";
import { ApiError } from "@/lib/api";
import { getErrorMessage, getFieldErrors } from "@/lib/errors";
import { discountPercent, formatPrice } from "@/lib/format";
import type { AdminProductInput } from "@/types/admin";
import type { Category, Product } from "@/types/catalog";

interface ProductFormProps {
  product?: Product;
  categories: Category[];
  categoriesUnavailable?: boolean;
}

const FORM_FIELDS: Array<keyof ProductFormValues> = [
  "name",
  "categoryMode",
  "categoryId",
  "customCategory",
  "description",
  "mrpPrice",
  "sellingPrice",
  "stock",
  "slug",
  "imageUrl",
  "imageAlt",
];

function buildFormData(payload: AdminProductInput, file: File): FormData {
  const form = new FormData();
  if (payload.name !== undefined) form.set("name", payload.name);
  if (payload.category !== undefined) form.set("category", payload.category);
  if (payload.categoryId !== undefined && payload.categoryId !== null) {
    form.set("categoryId", String(payload.categoryId));
  }
  if (payload.description !== undefined) form.set("description", payload.description);
  if (payload.mrpPrice !== undefined) form.set("mrpPrice", String(payload.mrpPrice));
  if (payload.sellingPrice !== undefined) form.set("sellingPrice", String(payload.sellingPrice));
  if (payload.stock !== undefined) form.set("stock", String(payload.stock));
  if (payload.slug) form.set("slug", payload.slug);
  // Objects cannot travel as form fields; the server parses this back into
  // imageMeta before validating, so alt text is saved in the same request.
  if (payload.imageMeta !== undefined) form.set("imageMeta", JSON.stringify(payload.imageMeta));
  form.set("image", file);
  return form;
}

export function ProductForm({ product, categories, categoriesUnavailable = false }: ProductFormProps) {
  const isEdit = Boolean(product);
  const navigate = useNavigate();
  const toast = useToast();
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct(product?.id ?? 0);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const submittingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
    setError,
    setFocus,
    setValue,
    getValues,
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: productFormDefaults(product, categories),
    mode: "onSubmit",
  });

  const values = useWatch({ control });
  const categoryMode = values.categoryMode ?? "existing";
  const selectedCategory = categories.find(
    (category) => String(category.id) === (values.categoryId ?? ""),
  );
  const categoryLabel =
    categoryMode === "custom"
      ? values.customCategory?.trim() || "Uncategorised"
      : selectedCategory?.name ?? "Choose a category";

  const previewImage = objectUrl ?? values.imageUrl ?? "";
  const previewMrp = values.mrpPrice ?? "";
  const previewSelling = values.sellingPrice ?? "";
  const previewDiscount = discountPercent(previewMrp, previewSelling);
  const previewStock = Number(values.stock);
  const isBusy = createMutation.isPending || updateMutation.isPending || isUploading;

  useEffect(() => {
    if (!file) {
      setObjectUrl(null);
      return;
    }
    if (typeof URL.createObjectURL !== "function") {
      // Non-browser environments (e.g. jsdom) cannot preview local files.
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => {
      if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
    };
  }, [file]);

  function clearSelectedFile() {
    setFile(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const imageUrlRegistration = register("imageUrl", {
    onChange: () => {
      setRemoveImage(false);
      if (file) clearSelectedFile();
    },
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    if (!next) {
      clearSelectedFile();
      return;
    }
    const validation = validateImageFile(next);
    if (validation) {
      setFileError(validation);
      setFile(null);
      event.target.value = "";
      return;
    }
    setFileError(null);
    setRemoveImage(false);
    setFile(next);
  }

  function removeCurrentImage() {
    clearSelectedFile();
    setRemoveImage(true);
    setValue("imageUrl", "", { shouldDirty: true });
  }

  function applyServerErrors(error: unknown) {
    const fieldErrors = getFieldErrors(error);
    let applied = 0;
    const mode = getValues("categoryMode");

    for (const [field, message] of Object.entries(fieldErrors)) {
      let target: keyof ProductFormValues | null = null;
      if (field === "imageMeta.alt" || field === "imageMeta") target = "imageAlt";
      else if (field === "category") target = mode === "custom" ? "customCategory" : "categoryId";
      else if (FORM_FIELDS.includes(field as keyof ProductFormValues)) {
        target = field as keyof ProductFormValues;
      }

      if (target) {
        setError(target, { type: "server", message });
        applied += 1;
        setFocus(target);
      }
    }

    if (error instanceof ApiError && error.status === 409 && /slug/i.test(error.message)) {
      setError("slug", { type: "server", message: error.message });
      setFocus("slug");
      applied += 1;
    }

    if (applied > 0) {
      toast({
        title: "Check the highlighted fields",
        description: "The server rejected some values. Nothing was saved.",
        tone: "error",
      });
    } else {
      toast({
        title: "Couldn't save product",
        description: getErrorMessage(error),
        tone: "error",
      });
    }
  }

  const onValid = async (formValues: ProductFormValues) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsUploading(false);

    try {
      let uploadedPath: string | undefined;
      let localFile: File | null = null;

      if (file) {
        setIsUploading(true);
        const result = await uploadProductImage(file);
        setIsUploading(false);
        if (result.mode === "error") {
          setFileError(result.message);
          toast({ title: "Image upload failed", description: result.message, tone: "error" });
          return;
        }
        if (result.mode === "local") {
          // Local disk has no signed-upload flow, so the bytes travel with the
          // product form. Both create and update accept multipart now, which is
          // what makes image replacement work without hosted storage.
          localFile = file;
        } else {
          uploadedPath = result.objectPath;
        }
      }

      const categoryName =
        formValues.categoryMode === "custom"
          ? formValues.customCategory.trim()
          : selectedCategory?.name ?? "";
      const payload: AdminProductInput = {
        name: formValues.name.trim(),
        category: categoryName,
        description: formValues.description.trim(),
        mrpPrice: Number(formValues.mrpPrice),
        sellingPrice: Number(formValues.sellingPrice),
        stock: Number(formValues.stock),
      };

      if (formValues.categoryMode === "existing" && selectedCategory) {
        payload.categoryId = selectedCategory.id;
      } else if (isEdit) {
        // Explicitly unlink when switching to a free-text category.
        payload.categoryId = null;
      }

      if (formValues.slug.trim()) payload.slug = formValues.slug.trim();

      const originalImage = product?.image ?? "";
      // A selected local file wins over any URL field: it is sent as the
      // multipart payload, not as a text field.
      if (!localFile) {
        if (uploadedPath) {
          payload.image = uploadedPath;
        } else if (!isEdit) {
          if (formValues.imageUrl.trim()) payload.image = formValues.imageUrl.trim();
        } else if (removeImage) {
          payload.image = "";
        } else if (formValues.imageUrl.trim() !== originalImage) {
          payload.image = formValues.imageUrl.trim();
        }
      }

      const finalImage = uploadedPath ?? payload.image ?? (removeImage ? "" : originalImage);
      const hasImage = Boolean(finalImage || localFile);
      const alt = formValues.imageAlt.trim();
      if (hasImage && alt) {
        payload.imageMeta = { alt };
      } else if (isEdit && (removeImage || localFile || product?.imageMeta?.alt)) {
        // An empty object clears the previous metadata without inventing a new
        // alt. Replacing the image also drops a description that was about the
        // old picture.
        payload.imageMeta = {};
      }

      const body: AdminProductInput | FormData = localFile
        ? buildFormData(payload, localFile)
        : payload;

      if (!isEdit) {
        const response = await createMutation.mutateAsync(body);
        toast({
          title: "Product created",
          description: `“${response.product.name}” is now in the catalog.`,
          tone: "success",
        });
      } else {
        await updateMutation.mutateAsync(body);
        toast({ title: "Product updated", description: "The catalog has been refreshed.", tone: "success" });
      }
      navigate("/admin/products");
    } catch (error) {
      applyServerErrors(error);
    } finally {
      submittingRef.current = false;
      setIsUploading(false);
    }
  };

  const submit = handleSubmit(onValid, () => {
    toast({
      title: "Check the highlighted fields",
      description: "Fix the form errors before saving.",
      tone: "error",
    });
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {categoriesUnavailable ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Categories could not be loaded</AlertTitle>
          <AlertDescription>
            You can still type a custom category name. Existing-category selection is temporarily
            unavailable.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Basics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field id="product-name" label="Product name" required error={errors.name?.message}>
                {({ invalid, described }) => (
                  <Input
                    id="product-name"
                    {...register("name")}
                    aria-invalid={invalid}
                    aria-describedby={described}
                    autoComplete="off"
                    maxLength={200}
                  />
                )}
              </Field>

              <fieldset>
                <legend className="text-sm font-medium">Category source</legend>
                <div className="mt-2 flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      value="existing"
                      {...register("categoryMode")}
                      disabled={categories.length === 0}
                    />
                    Existing category
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" value="custom" {...register("categoryMode")} />
                    Custom name
                  </label>
                </div>
              </fieldset>

              {categoryMode === "existing" ? (
                <Field id="product-category" label="Category" required error={errors.categoryId?.message}>
                  {({ invalid, described }) => (
                    <Select
                      id="product-category"
                      {...register("categoryId")}
                      aria-invalid={invalid}
                      aria-describedby={described}
                      disabled={categories.length === 0}
                    >
                      <option value="">Choose a category</option>
                      {categories.map((category) => (
                        <option key={category.id} value={String(category.id)}>
                          {category.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <Field
                  id="product-custom-category"
                  label="Custom category name"
                  required
                  error={errors.customCategory?.message}
                  hint="Used for the legacy free-text category column."
                >
                  {({ invalid, described }) => (
                    <Input
                      id="product-custom-category"
                      {...register("customCategory")}
                      aria-invalid={invalid}
                      aria-describedby={described}
                      maxLength={100}
                    />
                  )}
                </Field>
              )}

              <Field
                id="product-description"
                label="Description"
                optional
                error={errors.description?.message}
                hint="Shown on the product page. Up to 5,000 characters."
              >
                {({ invalid, described }) => (
                  <Textarea
                    id="product-description"
                    {...register("description")}
                    aria-invalid={invalid}
                    aria-describedby={described}
                    rows={5}
                    maxLength={5000}
                  />
                )}
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pricing and inventory</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="product-mrp" label="MRP (₹)" required error={errors.mrpPrice?.message}>
                  {({ invalid, described }) => (
                    <Input
                      id="product-mrp"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      {...register("mrpPrice")}
                      aria-invalid={invalid}
                      aria-describedby={described}
                    />
                  )}
                </Field>
                <Field
                  id="product-selling"
                  label="Selling price (₹)"
                  required
                  error={errors.sellingPrice?.message}
                >
                  {({ invalid, described }) => (
                    <Input
                      id="product-selling"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      {...register("sellingPrice")}
                      aria-invalid={invalid}
                      aria-describedby={described}
                    />
                  )}
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="product-stock"
                  label="Stock"
                  required
                  error={errors.stock?.message}
                  hint="Whole units available."
                >
                  {({ invalid, described }) => (
                    <Input
                      id="product-stock"
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      {...register("stock")}
                      aria-invalid={invalid}
                      aria-describedby={described}
                    />
                  )}
                </Field>
                <Field
                  id="product-slug"
                  label="Slug"
                  optional
                  error={errors.slug?.message}
                  hint={
                    isEdit
                      ? "Leave unchanged to keep the current slug."
                      : "Leave blank to generate one from the name."
                  }
                >
                  {({ invalid, described }) => (
                    <Input
                      id="product-slug"
                      {...register("slug")}
                      aria-invalid={invalid}
                      aria-describedby={described}
                      autoComplete="off"
                      placeholder="e.g. steel-water-bottle"
                    />
                  )}
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Image</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field
                id="imageUrl"
                label="Image URL"
                optional
                error={errors.imageUrl?.message}
                hint="External https:// URLs and existing /uploads/… paths are passed to the server."
              >
                {({ invalid, described }) => (
                  <Input
                    id="imageUrl"
                    {...imageUrlRegistration}
                    aria-invalid={invalid}
                    aria-describedby={described}
                    placeholder="https://…"
                    autoComplete="off"
                  />
                )}
              </Field>

              <div className="space-y-2">
                <label htmlFor="product-image-file" className="text-sm font-medium">
                  {isEdit ? "Replace image with a file" : "Or upload an image file"}{" "}
                  <span className="text-xs font-normal text-muted-foreground">Optional</span>
                </label>
                <input
                  ref={fileInputRef}
                  id="product-image-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handleFileChange}
                  className="block w-full cursor-pointer rounded-md border border-input bg-card text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <p className="text-xs text-muted-foreground">
                  JPEG, PNG, WebP or GIF, up to 5 MB. With hosted storage the file uploads directly
                  through a short-lived signed URL; with local disk it is submitted with this form.
                  The service-role key never reaches the browser.
                </p>
                {file ? (
                  <p className="flex flex-wrap items-center gap-2 text-xs">
                    <Upload className="size-3.5" aria-hidden="true" />
                    Selected: {file.name} ({Math.ceil(file.size / 1024)} KB)
                    <button
                      type="button"
                      onClick={clearSelectedFile}
                      className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Remove selected file
                    </button>
                  </p>
                ) : null}
                {fileError ? (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {fileError}
                  </p>
                ) : null}
              </div>

              <Field
                id="product-image-alt"
                label="Image alt text"
                optional
                error={errors.imageAlt?.message}
                hint="Describe the image for screen readers."
              >
                {({ invalid, described }) => (
                  <Input
                    id="product-image-alt"
                    {...register("imageAlt")}
                    aria-invalid={invalid}
                    aria-describedby={described}
                    maxLength={255}
                  />
                )}
              </Field>

              {previewImage || product?.image ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={removeCurrentImage}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 aria-hidden="true" />
                  Remove image
                </Button>
              ) : null}
            </CardContent>
          </Card>

          {isEdit && product ? (
            <ProductGalleryEditor
              productId={product.id}
              images={product.images ?? []}
              onPrimaryChange={(imageUrl, imageAlt) => {
                // Adding or promoting a gallery image changes the primary, so
                // the form fields follow instead of showing a stale preview.
                setValue("imageUrl", imageUrl);
                setValue("imageAlt", imageAlt);
                setRemoveImage(false);
              }}
            />
          ) : null}
        </div>

        <aside className="space-y-4">
          <Card className="lg:sticky lg:top-24">
            <CardHeader>
              <CardTitle className="text-lg">Storefront preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ProductThumb
                src={previewImage || undefined}
                name={values.name ?? "Product"}
                className="aspect-square h-auto w-full rounded-md"
              />
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{categoryLabel}</p>
                <h2 className="mt-1 text-lg font-semibold leading-tight">
                  {values.name?.trim() || "Product name"}
                </h2>
                <div className="mt-2 flex flex-wrap items-baseline gap-2">
                  <span className="text-xl font-semibold tabular-nums">
                    {Number.isFinite(Number(previewSelling)) && previewSelling !== ""
                      ? formatPrice(previewSelling)
                      : "—"}
                  </span>
                  {previewDiscount !== null ? (
                    <>
                      <span className="text-sm text-muted-foreground line-through tabular-nums">
                        {formatPrice(previewMrp)}
                      </span>
                      <Badge variant="success">−{previewDiscount}%</Badge>
                    </>
                  ) : null}
                </div>
                <div className="mt-2">
                  {Number.isFinite(previewStock) && previewStock <= 0 ? (
                    <Badge variant="destructive">Out of stock</Badge>
                  ) : Number.isFinite(previewStock) && previewStock <= 5 ? (
                    <Badge variant="outline">Low stock: {previewStock}</Badge>
                  ) : (
                    <Badge variant="success">In stock</Badge>
                  )}
                </div>
                <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
                  {values.description?.trim() || "No description yet."}
                </p>
              </div>

              {product ? (
                <Button asChild variant="outline" size="sm" className="w-full">
                  <a href={`/product/${product.id}`} target="_blank" rel="noreferrer">
                    <Store aria-hidden="true" />
                    Open storefront page
                  </a>
                </Button>
              ) : (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  The storefront link appears after the product is created.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-secondary/40">
            <CardContent className="space-y-2 p-4 text-xs text-muted-foreground">
              <p className="flex items-start gap-2">
                <ImagePlus className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                Direct uploads are verified by the server before any product row is written.
              </p>
              <p className="flex items-start gap-2">
                <Save className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                The server re-validates prices, stock, category links and slugs on save.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Button asChild variant="outline" type="button">
          <Link to="/admin/products">Cancel</Link>
        </Button>
        <Button type="submit" disabled={isBusy}>
          {isBusy ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              {isUploading ? "Uploading image…" : "Saving…"}
            </>
          ) : (
            <>
              <Save aria-hidden="true" />
              {isEdit ? "Save changes" : "Add product"}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
