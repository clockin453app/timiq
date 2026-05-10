"use client";

import { FormEvent, useEffect, useState } from "react";

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
  updateLocationStatus,
  type Location,
} from "../../features/locations/api";

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
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isGettingPosition, setIsGettingPosition] = useState(false);
  const [updatingLocationId, setUpdatingLocationId] = useState<string | null>(
    null,
  );

  const showCompanySelector = isAdministrator(currentUser);

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

      const firstActiveCompany = loadedCompanies.find(
        (company) => company.is_active,
      );

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

  async function handleCreateLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");
    setIsCreating(true);

    if (showCompanySelector && !companyId) {
      setErrorMessage("Select a company for this location.");
      setIsCreating(false);
      return;
    }

    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);
    const parsedRadius = Number(geofenceRadiusMeters);

    if (Number.isNaN(parsedLatitude) || Number.isNaN(parsedLongitude)) {
      setErrorMessage("Enter valid latitude and longitude.");
      setIsCreating(false);
      return;
    }

    if (Number.isNaN(parsedRadius) || parsedRadius < 10) {
      setErrorMessage("Geofence radius must be at least 10 meters.");
      setIsCreating(false);
      return;
    }

    try {
      const createdLocation = await createLocation({
        company_id: showCompanySelector ? companyId : undefined,
        name,
        address: address || null,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        geofence_radius_meters: parsedRadius,
        is_active: true,
      });

      setSuccessMessage(`Created ${createdLocation.name}`);
      setName("");
      setAddress("");
      setLatitude("");
      setLongitude("");
      setGeofenceRadiusMeters("100");
      await loadLocations();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not create location.",
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function handleToggleLocationStatus(location: Location) {
    setErrorMessage("");
    setSuccessMessage("");
    setUpdatingLocationId(location.id);

    try {
      const updatedLocation = await updateLocationStatus(
        location.id,
        !location.is_active,
      );

      setSuccessMessage(
        `${updatedLocation.name} is now ${
          updatedLocation.is_active ? "active" : "inactive"
        }`,
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
        description="Create geofenced work locations with GPS coordinates."
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
            onSubmit={handleCreateLocation}
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

            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
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
                  max="5000"
                  min="10"
                  name="radius"
                  onChange={(event) =>
                    setGeofenceRadiusMeters(event.target.value)
                  }
                  required
                  type="number"
                  value={geofenceRadiusMeters}
                />
              </label>

              <div className="flex flex-col">
                <span className="mb-1 text-xs font-bold opacity-0">
                  Current GPS
                </span>
                <Button
                  className="h-10"
                  disabled={isGettingPosition}
                  onClick={handleUseCurrentPosition}
                  type="button"
                >
                  {isGettingPosition ? "Getting..." : "Use current GPS"}
                </Button>
              </div>

              <div className="flex flex-col">
                <span className="mb-1 text-xs font-bold opacity-0">Action</span>
                <Button className="h-10" disabled={isCreating} type="submit">
                  {isCreating ? "Creating..." : "Create location"}
                </Button>
              </div>
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
                    const company = companies.find(
                      (item) => item.id === location.company_id,
                    );

                    return (
                      <TableRow key={location.id}>
                        <TableCell>{location.name}</TableCell>
                        <TableCell>{location.address ?? "-"}</TableCell>
                        <TableCell>
                          {company?.name ?? "Assigned company"}
                        </TableCell>
                        <TableCell>{location.latitude.toFixed(6)}</TableCell>
                        <TableCell>{location.longitude.toFixed(6)}</TableCell>
                        <TableCell>
                          {location.geofence_radius_meters}m
                        </TableCell>
                        <TableCell>
                          {location.is_active ? "Active" : "Inactive"}
                        </TableCell>
                        <TableCell>
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