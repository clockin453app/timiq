"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { LocationGeofenceMap } from "../../components/maps";
import {
  Badge,
  Button,
  PageHeader,
  Sheet,
  SheetBody,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui";
import {
  isAdministrator,
  RoleGuard,
  useCurrentUser,
} from "../../features/auth";
import { CompanySelector } from "../../features/companies/company-selector";
import { listCompanies, type Company } from "../../features/companies/api";
import { useAdministratorCompanyScope } from "../../features/companies/selected-company";
import {
  createLocation,
  listLocations,
  updateLocation,
  updateLocationStatus,
  type Location,
} from "../../features/locations/api";
import { searchNominatim, type NominatimSearchHit } from "../../features/locations/nominatim";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

const FIELD_LABEL_CLASS =
  "block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]";
const FIELD_INPUT_CLASS =
  "mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm";

const DEFAULT_LAT = 51.507351;
const DEFAULT_LNG = -0.127758;

function parseLatitude(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : DEFAULT_LAT;
}

function parseLongitude(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : DEFAULT_LNG;
}

function parseRadius(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return 100;
  }
  return Math.min(5000, Math.max(10, parsed));
}

export function LocationsClient() {
  const t = useT();
  const currentUser = useCurrentUser();

  const [locations, setLocations] = useState<Location[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [geofenceRadiusMeters, setGeofenceRadiusMeters] = useState("100");
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGettingPosition, setIsGettingPosition] = useState(false);
  const [updatingLocationId, setUpdatingLocationId] = useState<string | null>(null);
  const [addressSearchQuery, setAddressSearchQuery] = useState("");
  const [addressSearchResults, setAddressSearchResults] = useState<NominatimSearchHit[]>([]);
  const [addressSearchLoading, setAddressSearchLoading] = useState(false);
  const [addressSearchError, setAddressSearchError] = useState("");

  const showCompanySelector = isAdministrator(currentUser);
  const companyScope = useAdministratorCompanyScope(currentUser, companies);

  const mapLatitude = parseLatitude(latitude);
  const mapLongitude = parseLongitude(longitude);
  const mapRadius = parseRadius(geofenceRadiusMeters);

  const handleMapLatLng = useCallback((lat: number, lng: number) => {
    setLatitude(lat.toFixed(6));
    setLongitude(lng.toFixed(6));
  }, []);

  function applyNominatimHit(hit: NominatimSearchHit) {
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setAddressSearchError("Could not use this search result.");
      return;
    }
    setLatitude(lat.toFixed(6));
    setLongitude(lng.toFixed(6));
    setAddress((current) => (current.trim() ? current : hit.display_name));
    setAddressSearchResults([]);
    setAddressSearchError("");
  }

  async function handleAddressSearch() {
    setAddressSearchError("");
    setAddressSearchLoading(true);
    setAddressSearchResults([]);
    try {
      const hits = await searchNominatim(addressSearchQuery);
      setAddressSearchResults(hits);
      if (hits.length === 0) {
        setAddressSearchError("No matches found.");
      }
    } catch (error) {
      setAddressSearchError(error instanceof Error ? error.message : "Search failed.");
    } finally {
      setAddressSearchLoading(false);
    }
  }

  async function loadLocations(viewCompanyId: string | null) {
    setIsLoading(true);

    try {
      if (showCompanySelector && !viewCompanyId) {
        setLocations([]);
        return;
      }
      const loadedLocations = await listLocations(
        showCompanySelector ? viewCompanyId : currentUser?.company_id ?? null,
      );
      setLocations(loadedLocations);
    } catch {
      setErrorMessage("Could not load locations.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadCompanies() {
    try {
      const loadedCompanies = await listCompanies();
      setCompanies(loadedCompanies);
    } catch {
      setErrorMessage("Could not load companies.");
    }
  }

  useEffect(() => {
    void loadCompanies();
  }, []);

  useEffect(() => {
    const viewId = showCompanySelector ? companyScope.companyId : currentUser?.company_id ?? null;
    void loadLocations(viewId);
  }, [showCompanySelector, companyScope.companyId, currentUser?.company_id]);

  useEffect(() => {
    if (companyScope.companyId) {
      setCompanyId(companyScope.companyId);
    }
  }, [companyScope.companyId]);

  function resetCreateFormFields() {
    setEditingLocation(null);
    setName("");
    setAddress("");
    setLatitude("");
    setLongitude("");
    setGeofenceRadiusMeters("100");
  }

  function startEditing(location: Location) {
    setEditingLocation(location);
    setCompanyId(location.company_id);
    setName(location.name);
    setAddress(location.address ?? "");
    setLatitude(location.latitude.toFixed(6));
    setLongitude(location.longitude.toFixed(6));
    setGeofenceRadiusMeters(String(location.geofence_radius_meters));
  }

  function handleUseCurrentPosition() {
    setErrorMessage("");

    if (!navigator.geolocation) {
      setErrorMessage("Geolocation is not supported by this browser.");
      return;
    }

    setIsGettingPosition(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setIsGettingPosition(false);
      },
      () => {
        setErrorMessage("Could not get current position.");
        setIsGettingPosition(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      },
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");
    setIsSaving(true);

    if (showCompanySelector && !companyId) {
      setErrorMessage("Select a company for this location.");
      setIsSaving(false);
      return;
    }

    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);
    const parsedRadius = Number(geofenceRadiusMeters);

    if (Number.isNaN(parsedLatitude) || Number.isNaN(parsedLongitude)) {
      setErrorMessage("Enter valid latitude and longitude.");
      setIsSaving(false);
      return;
    }

    if (Number.isNaN(parsedRadius) || parsedRadius < 10) {
      setErrorMessage("Geofence radius must be at least 10 meters.");
      setIsSaving(false);
      return;
    }

    try {
      if (editingLocation) {
        await updateLocation(editingLocation.id, {
          company_id: showCompanySelector ? companyId : undefined,
          name,
          address: address || null,
          latitude: parsedLatitude,
          longitude: parsedLongitude,
          geofence_radius_meters: parsedRadius,
          is_active: editingLocation.is_active,
        });
        setSuccessMessage(`Updated ${name}`);
        resetCreateFormFields();
      } else {
        await createLocation({
          company_id: showCompanySelector ? companyId : undefined,
          name,
          address: address || null,
          latitude: parsedLatitude,
          longitude: parsedLongitude,
          geofence_radius_meters: parsedRadius,
          is_active: true,
        });
        setSuccessMessage(`Created ${name}`);
        setName("");
        setAddress("");
        setLatitude("");
        setLongitude("");
        setGeofenceRadiusMeters("100");
      }

      await loadLocations(showCompanySelector ? companyScope.companyId : currentUser?.company_id ?? null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not save location.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleLocationStatus(location: Location) {
    setErrorMessage("");
    setSuccessMessage("");
    setUpdatingLocationId(location.id);

    try {
      const updatedLocation = await updateLocationStatus(location.id, !location.is_active);

      setSuccessMessage(
        `${updatedLocation.name} is now ${updatedLocation.is_active ? "active" : "inactive"}`,
      );

      await loadLocations(showCompanySelector ? companyScope.companyId : currentUser?.company_id ?? null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not update location.",
      );
    } finally {
      setUpdatingLocationId(null);
    }
  }

  return (
    <Sheet>
      <PageHeader
        title={t("locations.title", "Sites")}
        description={
          editingLocation
            ? t("locations.editing", "Editing {{name}}. Adjust map, fields, then save.", {
                name: editingLocation.name,
              })
            : t(
                "locations.description",
                "Operational sites for clock-in, GPS geofence, site access, and site payroll rules.",
              )
        }
      />

      <SheetBody className="min-w-0 space-y-5 lg:space-y-6">
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to manage locations.
            </div>
          }
        >
          {showCompanySelector && companyScope.companies.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2.5">
              <CompanySelector
                companies={companyScope.companies}
                onChange={companyScope.setCompanyId}
                value={companyScope.companyId}
              />
              {companyScope.scopeLabel ? (
                <p className="text-xs text-[var(--color-text-muted)]">{companyScope.scopeLabel}</p>
              ) : null}
            </div>
          ) : (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2.5 text-sm text-[var(--color-text-muted)]">
              You can create geofenced locations for your company only.
            </div>
          )}

          {showCompanySelector && companyScope.needsCompanySelection ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
              Select a company to view its sites.
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
            <form
              className={cn(uiClasses.card, "overflow-hidden")}
              onSubmit={handleSubmit}
            >
              <div className={cn(uiClasses.cardHeader, "py-3")}>
                <h2 className="text-sm font-semibold tracking-tight text-[var(--color-text)]">
                  {editingLocation ? "Edit site" : "Add site"}
                </h2>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  {editingLocation
                    ? "Update site details, coordinates, and geofence radius."
                    : "Define a clock-in site with GPS coordinates and geofence radius."}
                </p>
              </div>

              <div className="space-y-4 px-[var(--space-card)] py-4">
                {errorMessage ? (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)]/30 bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
                    {errorMessage}
                  </div>
                ) : null}

                {successMessage ? (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-success-700)]/25 bg-[var(--color-success-50)] px-3 py-2 text-sm text-[var(--color-success-700)]">
                    {successMessage}
                  </div>
                ) : null}

                <section className="space-y-3">
                  <h3 className="text-xs font-semibold tracking-tight text-[var(--color-text)]">Site details</h3>
                  <div className="space-y-3">
                    {showCompanySelector ? (
                      <label className={FIELD_LABEL_CLASS}>
                        Company
                        <select
                          className={FIELD_INPUT_CLASS}
                          onChange={(event) => setCompanyId(event.target.value)}
                          required
                          value={companyId}
                        >
                          {companies
                            .filter((company) => company.is_active)
                            .map((company) => (
                              <option key={company.id} value={company.id}>
                                {company.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : null}

                    <label className={FIELD_LABEL_CLASS}>
                      Location name
                      <input
                        className={FIELD_INPUT_CLASS}
                        name="name"
                        onChange={(event) => setName(event.target.value)}
                        required
                        type="text"
                        value={name}
                      />
                    </label>

                    <label className={FIELD_LABEL_CLASS}>
                      Address
                      <input
                        className={FIELD_INPUT_CLASS}
                        name="address"
                        onChange={(event) => setAddress(event.target.value)}
                        type="text"
                        value={address}
                      />
                    </label>
                  </div>
                </section>

                <section className="space-y-3 border-t border-[var(--color-border)] pt-4">
                  <h3 className="text-xs font-semibold tracking-tight text-[var(--color-text)]">
                    Coordinates &amp; geofence
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className={FIELD_LABEL_CLASS}>
                      Latitude
                      <input
                        className={FIELD_INPUT_CLASS}
                        name="latitude"
                        onChange={(event) => setLatitude(event.target.value)}
                        placeholder="51.507351"
                        required
                        step="0.000001"
                        type="number"
                        value={latitude}
                      />
                    </label>

                    <label className={FIELD_LABEL_CLASS}>
                      Longitude
                      <input
                        className={FIELD_INPUT_CLASS}
                        name="longitude"
                        onChange={(event) => setLongitude(event.target.value)}
                        placeholder="-0.127758"
                        required
                        step="0.000001"
                        type="number"
                        value={longitude}
                      />
                    </label>

                    <label className={cn(FIELD_LABEL_CLASS, "sm:col-span-2")}>
                      Radius meters
                      <input
                        className={FIELD_INPUT_CLASS}
                        max={5000}
                        min={10}
                        name="radius"
                        onChange={(event) => setGeofenceRadiusMeters(event.target.value)}
                        required
                        type="number"
                        value={geofenceRadiusMeters}
                      />
                    </label>
                  </div>
                </section>

                <section className="space-y-3 border-t border-[var(--color-border)] pt-4">
                  <div>
                    <h3 className="text-xs font-semibold tracking-tight text-[var(--color-text)]">
                      Address search
                    </h3>
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                      OpenStreetMap Nominatim — search by street or place name, then pick a result to
                      move the map and coordinates.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      className={cn(FIELD_INPUT_CLASS, "mt-0 min-w-0 flex-1")}
                      onChange={(event) => setAddressSearchQuery(event.target.value)}
                      placeholder="Address search"
                      type="text"
                      value={addressSearchQuery}
                    />
                    <Button
                      className="shrink-0"
                      disabled={addressSearchLoading}
                      onClick={handleAddressSearch}
                      type="button"
                      variant="secondary"
                    >
                      {addressSearchLoading ? "Searching..." : "Search address"}
                    </Button>
                  </div>
                  {addressSearchError ? (
                    <p className="text-xs text-[var(--color-danger-700)]">{addressSearchError}</p>
                  ) : null}
                  {addressSearchResults.length > 0 ? (
                    <ul className="max-h-40 space-y-1 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)]/50 text-xs">
                      {addressSearchResults.map((hit, index) => (
                        <li key={`${hit.lat}-${hit.lon}-${index}`}>
                          <button
                            className="w-full rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-header)]"
                            onClick={() => applyNominatimHit(hit)}
                            type="button"
                          >
                            <span className="font-medium text-[var(--color-text)]">{hit.display_name}</span>
                            <span className="mt-0.5 block tabular-nums text-[var(--color-text-muted)]">
                              {hit.lat}, {hit.lon}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>

                <section className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4">
                  <Button disabled={isGettingPosition} onClick={handleUseCurrentPosition} type="button" variant="secondary">
                    {isGettingPosition ? "Getting..." : "Use current GPS"}
                  </Button>
                  <div className="flex flex-wrap gap-2">
                    {editingLocation ? (
                      <Button
                        onClick={() => {
                          resetCreateFormFields();
                          setSuccessMessage("");
                        }}
                        type="button"
                        variant="ghost"
                      >
                        Cancel edit
                      </Button>
                    ) : null}
                    <Button disabled={isSaving} type="submit">
                      {isSaving ? "Saving..." : editingLocation ? "Save changes" : "Create location"}
                    </Button>
                  </div>
                </section>
              </div>
            </form>

            <section
              className={cn(
                uiClasses.card,
                "flex min-h-[min(520px,calc(100dvh-14rem))] flex-col overflow-hidden",
              )}
            >
              <div className={cn(uiClasses.cardHeader, "py-3")}>
                <h2 className="text-sm font-semibold tracking-tight text-[var(--color-text)]">
                  Map preview
                </h2>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  Click the map or drag the marker to set coordinates. Radius updates the geofence ring.
                </p>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-3 px-[var(--space-card)] py-4">
                <div className="flex min-h-[280px] flex-1 flex-col lg:min-h-[420px] [&_.timiq-leaflet-shell]:!h-full [&_.timiq-leaflet-shell]:!min-h-[280px] lg:[&_.timiq-leaflet-shell]:!min-h-[420px]">
                  <LocationGeofenceMap
                    key={editingLocation?.id ?? "create"}
                    latitude={mapLatitude}
                    longitude={mapLongitude}
                    onLatLngChange={handleMapLatLng}
                    radiusMeters={mapRadius}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-header)] px-2.5 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
                      Latitude
                    </p>
                    <p className="mt-0.5 text-xs font-semibold tabular-nums text-[var(--color-text)]">
                      {latitude || "—"}
                    </p>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-header)] px-2.5 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
                      Longitude
                    </p>
                    <p className="mt-0.5 text-xs font-semibold tabular-nums text-[var(--color-text)]">
                      {longitude || "—"}
                    </p>
                  </div>
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-header)] px-2.5 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
                      Radius
                    </p>
                    <p className="mt-0.5 text-xs font-semibold tabular-nums text-[var(--color-text)]">
                      {geofenceRadiusMeters}m
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className={cn(uiClasses.card, "overflow-hidden")}>
            <div className={cn(uiClasses.cardHeader, "flex flex-wrap items-center justify-between gap-2 py-3")}>
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-[var(--color-text)]">
                  Existing locations
                </h2>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  Sites available for clock-in, geofence validation, and site access.
                </p>
              </div>
              {!isLoading ? (
                <Badge tone="default">{locations.length}</Badge>
              ) : null}
            </div>

            <div className={uiClasses.tableWrap}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Latitude</TableHead>
                    <TableHead>Longitude</TableHead>
                    <TableHead>Radius</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell className="py-8 text-center text-[var(--color-text-muted)]" colSpan={8}>
                        Loading locations...
                      </TableCell>
                    </TableRow>
                  ) : null}

                  {!isLoading && locations.length === 0 ? (
                    <TableRow>
                      <TableCell className="py-8" colSpan={8}>
                        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-dark)] bg-[var(--color-header)]/45 px-4 py-6 text-center">
                          <p className="text-sm font-medium text-[var(--color-text)]">No locations found.</p>
                          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                            Create your first site using the form above.
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}

                  {!isLoading
                    ? locations.map((location) => {
                        const company = companies.find((item) => item.id === location.company_id);

                        return (
                          <TableRow key={location.id}>
                            <TableCell className="font-medium">{location.name}</TableCell>
                            <TableCell>{location.address ?? "-"}</TableCell>
                            <TableCell>{company?.name ?? "Assigned company"}</TableCell>
                            <TableCell className="tabular-nums text-xs text-[var(--color-text-muted)]">
                              {location.latitude.toFixed(6)}
                            </TableCell>
                            <TableCell className="tabular-nums text-xs text-[var(--color-text-muted)]">
                              {location.longitude.toFixed(6)}
                            </TableCell>
                            <TableCell className="tabular-nums">{location.geofence_radius_meters}m</TableCell>
                            <TableCell>
                              <Badge tone={location.is_active ? "success" : "default"}>
                                {location.is_active ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-2">
                                <Button onClick={() => startEditing(location)} type="button" variant="secondary">
                                  Edit
                                </Button>
                                <Button
                                  disabled={updatingLocationId === location.id}
                                  onClick={() => handleToggleLocationStatus(location)}
                                  type="button"
                                  variant="ghost"
                                >
                                  {updatingLocationId === location.id
                                    ? "Updating..."
                                    : location.is_active
                                      ? "Deactivate"
                                      : "Activate"}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    : null}
                </TableBody>
              </Table>
            </div>
          </section>
        </RoleGuard>
      </SheetBody>
    </Sheet>
  );
}
