"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { LocationGeofenceMap } from "../../components/maps";
import {
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
import { listCompanies, type Company } from "../../features/companies/api";
import {
  createLocation,
  listLocations,
  updateLocation,
  updateLocationStatus,
  type Location,
} from "../../features/locations/api";
import { searchNominatim, type NominatimSearchHit } from "../../features/locations/nominatim";

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

  async function loadLocations() {
    setIsLoading(true);

    try {
      const loadedLocations = await listLocations();
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

      const firstActiveCompany = loadedCompanies.find((company) => company.is_active);

      if (firstActiveCompany) {
        setCompanyId((currentValue) => currentValue || firstActiveCompany.id);
      }
    } catch {
      setErrorMessage("Could not load companies.");
    }
  }

  useEffect(() => {
    loadLocations();
    loadCompanies();
  }, []);

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

      await loadLocations();
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

      await loadLocations();
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
        title="Locations"
        description={
          editingLocation
            ? `Editing ${editingLocation.name}. Adjust map, fields, then save.`
            : "Create geofenced work locations with GPS coordinates."
        }
      />

      <SheetBody>
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to manage locations.
            </div>
          }
        >
          <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm">
            {isAdministrator(currentUser)
              ? "You can create geofenced locations for any company."
              : "You can create geofenced locations for your company only."}
          </div>

          <form
            className="mb-4 border border-[var(--color-border)] bg-[var(--color-cell)] p-3"
            onSubmit={handleSubmit}
          >
            <div
              className={
                showCompanySelector
                  ? "grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]"
                  : "grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"
              }
            >
              {showCompanySelector ? (
                <label className="block text-xs font-bold text-[var(--color-text)]">
                  Company
                  <select
                    className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
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

              <label className="block text-xs font-bold text-[var(--color-text)]">
                Location name
                <input
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  name="name"
                  onChange={(event) => setName(event.target.value)}
                  required
                  type="text"
                  value={name}
                />
              </label>

              <label className="block text-xs font-bold text-[var(--color-text)]">
                Address
                <input
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  name="address"
                  onChange={(event) => setAddress(event.target.value)}
                  type="text"
                  value={address}
                />
              </label>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <label className="block text-xs font-bold text-[var(--color-text)]">
                Latitude
                <input
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  name="latitude"
                  onChange={(event) => setLatitude(event.target.value)}
                  placeholder="51.507351"
                  required
                  step="0.000001"
                  type="number"
                  value={latitude}
                />
              </label>

              <label className="block text-xs font-bold text-[var(--color-text)]">
                Longitude
                <input
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  name="longitude"
                  onChange={(event) => setLongitude(event.target.value)}
                  placeholder="-0.127758"
                  required
                  step="0.000001"
                  type="number"
                  value={longitude}
                />
              </label>

              <label className="block text-xs font-bold text-[var(--color-text)]">
                Radius meters
                <input
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
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

            <div className="mt-3 border border-[var(--color-border)] bg-[var(--color-header)] p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
                Address search (OpenStreetMap Nominatim)
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Search by street or place name, pick a result to move the map and coordinates.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  className="h-10 min-w-[12rem] flex-1 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(event) => setAddressSearchQuery(event.target.value)}
                  placeholder="Address search"
                  type="text"
                  value={addressSearchQuery}
                />
                <Button disabled={addressSearchLoading} onClick={handleAddressSearch} type="button">
                  {addressSearchLoading ? "Searching..." : "Search address"}
                </Button>
              </div>
              {addressSearchError ? (
                <p className="mt-2 text-xs text-[var(--color-danger-700)]">{addressSearchError}</p>
              ) : null}
              {addressSearchResults.length > 0 ? (
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto border border-[var(--color-border-dark)] bg-[var(--color-cell)] text-xs">
                  {addressSearchResults.map((hit, index) => (
                    <li key={`${hit.lat}-${hit.lon}-${index}`}>
                      <button
                        className="w-full px-2 py-1.5 text-left hover:bg-[var(--color-header)]"
                        onClick={() => applyNominatimHit(hit)}
                        type="button"
                      >
                        <span className="font-medium text-[var(--color-text)]">{hit.display_name}</span>
                        <span className="mt-0.5 block text-[var(--color-text-muted)]">
                          {hit.lat}, {hit.lon}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="mt-3">
              <p className="mb-1 text-xs font-bold text-[var(--color-text-soft)]">
                Map preview
              </p>
              <p className="mb-2 text-xs text-[var(--color-text-muted)]">
                Click the map or drag the marker to set coordinates. Radius updates the geofence ring.
              </p>
              <LocationGeofenceMap
                key={editingLocation?.id ?? "create"}
                latitude={mapLatitude}
                longitude={mapLongitude}
                onLatLngChange={handleMapLatLng}
                radiusMeters={mapRadius}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled={isGettingPosition} onClick={handleUseCurrentPosition} type="button">
                {isGettingPosition ? "Getting..." : "Use current GPS"}
              </Button>
              <Button disabled={isSaving} type="submit">
                {isSaving ? "Saving..." : editingLocation ? "Save changes" : "Create location"}
              </Button>
              {editingLocation ? (
                <Button
                  onClick={() => {
                    resetCreateFormFields();
                    setSuccessMessage("");
                  }}
                  type="button"
                >
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </form>

          {errorMessage ? (
            <div className="mb-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
              {errorMessage}
            </div>
          ) : null}

          {successMessage ? (
            <div className="mb-3 border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
              {successMessage}
            </div>
          ) : null}

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
                  <TableCell colSpan={8}>Loading locations...</TableCell>
                </TableRow>
              ) : null}

              {!isLoading && locations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>No locations found.</TableCell>
                </TableRow>
              ) : null}

              {!isLoading
                ? locations.map((location) => {
                    const company = companies.find((item) => item.id === location.company_id);

                    return (
                      <TableRow key={location.id}>
                        <TableCell>{location.name}</TableCell>
                        <TableCell>{location.address ?? "-"}</TableCell>
                        <TableCell>{company?.name ?? "Assigned company"}</TableCell>
                        <TableCell>{location.latitude.toFixed(6)}</TableCell>
                        <TableCell>{location.longitude.toFixed(6)}</TableCell>
                        <TableCell>{location.geofence_radius_meters}m</TableCell>
                        <TableCell>{location.is_active ? "Active" : "Inactive"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button onClick={() => startEditing(location)} type="button">
                              Edit
                            </Button>
                            <Button
                              disabled={updatingLocationId === location.id}
                              onClick={() => handleToggleLocationStatus(location)}
                              type="button"
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
        </RoleGuard>
      </SheetBody>
    </Sheet>
  );
}
