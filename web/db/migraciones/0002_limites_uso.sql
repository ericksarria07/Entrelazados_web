CREATE TABLE "limites_uso" (
	"clave" varchar(200) PRIMARY KEY NOT NULL,
	"cuenta" integer NOT NULL,
	"vence" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_limites_uso_vence" ON "limites_uso" USING btree ("vence");